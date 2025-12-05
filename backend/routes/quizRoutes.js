// backend/routes/quizRoutes.js
const express = require("express");
const router = express.Router();
const Quiz = require("../models/Quiz");
const auth = require("../middlewares/authMiddleware");
const sockets = require("../sockets"); // socket helper
const redisService = require("../services/redisService");
const { scoreCalculationQueue, leaderboardQueue } = require("../queues");


// ---------------------------------------------
// CREATE QUIZ (TEACHER)
// ---------------------------------------------
router.post("/", auth, async (req, res) => {
  try {
    if (req.user.role !== "teacher")
      return res.status(403).json({ message: "Only teachers can create quizzes" });

    const { title, questions, duration } = req.body;
    // generate a short unique join code for the quiz
    async function generateCode(len = 6) {
      const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      function one() {
        let s = '';
        for (let i = 0; i < len; i++) s += CHARS[Math.floor(Math.random() * CHARS.length)];
        return s;
      }

      for (let attempt = 0; attempt < 8; attempt++) {
        const candidate = one();
        // ensure uniqueness
        const exists = await Quiz.findOne({ code: candidate }).lean();
        if (!exists) return candidate;
      }
      // fallback: timestamp-based
      return Date.now().toString().slice(-6).toUpperCase();
    }

    const code = await generateCode(6);
    const quizData = { title, questions, teacher: req.user.id, code };
    if (duration) quizData.duration = duration; // Add duration if provided
    const quiz = new Quiz(quizData);
    await quiz.save();
    console.log("Quiz created with duration:", quiz.duration); // Debug log
    res.json(quiz);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------------------------------------
// GET QUIZ BY JOIN CODE (students use this to find live quiz)
// ---------------------------------------------
router.get("/code/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!code) return res.status(400).json({ message: "Code required" });
    const quiz = await Quiz.findOne({ code }).lean();
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });
    // Allow joining even if not live (student will wait in lobby)
    // if (quiz.status !== "live") return res.status(400).json({ message: "Quiz is not live" });
    return res.json(quiz);
  } catch (err) {
    console.error("Lookup by code error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------------------------------------------
// LIST ALL QUIZZES
// ---------------------------------------------
router.get("/", auth, async (req, res) => {
  try {
    const list = await Quiz.find().sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------------------------------------
// UPDATE QUIZ STATUS (LIVE / FINISHED)
// ---------------------------------------------
router.patch("/:id/status", auth, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });
    if (String(quiz.teacher) !== String(req.user.id))
      return res.status(403).json({ message: "Not allowed" });

    quiz.status = req.body.status;
    if (quiz.status === "live" && !quiz.startedAt) {
      quiz.startedAt = new Date();
    }
    await quiz.save();
    res.json(quiz);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------------------------------------
// ADD QUESTION TO EXISTING QUIZ
// ---------------------------------------------
router.post("/:id/question", auth, async (req, res) => {
  const quizId = req.params.id;
  const { text, options, correctIndex } = req.body;

  if (!text || !Array.isArray(options) || options.length < 2) {
    return res.status(400).json({ message: "Question text and at least 2 options required" });
  }

  try {
    const quiz = await Quiz.findById(quizId);
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });
    if (String(quiz.teacher) !== String(req.user.id))
      return res.status(403).json({ message: "Not allowed" });

    quiz.questions.push({
      text,
      options,
      correctIndex: typeof correctIndex === "number" ? correctIndex : null
    });

    await quiz.save();
    const added = quiz.questions[quiz.questions.length - 1];

    // Broadcast updated list
    const io = sockets.getIo();
    if (io) {
      const formatted = quiz.questions.map(q => ({
        id: q._id,
        text: q.text,
        options: q.options,
      }));

      io.to(quizId).emit("quiz:questionList", {
        quizId,
        questions: formatted
      });

      // Sync with Redis for late joiners
      await redisService.setQuestionsList(quizId, formatted);

      try {
        const qdoc = quiz.toObject ? quiz.toObject() : quiz;
        if (qdoc && qdoc.code) {
          io.to(String(qdoc.code)).emit("quiz:questionList", {
            quizId,
            questions: formatted
          });
        }
      } catch (e) { /* ignore */ }
    }

    res.json({ ok: true, question: added, quiz });
  } catch (err) {
    console.error("Add question error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------------------------------------
// SUBMIT ANSWERS (STUDENT)
// ---------------------------------------------
// ---------------------------------------------
// SUBMIT SINGLE ANSWER (STUDENT)
// ---------------------------------------------
router.post("/:id/submit-single", auth, async (req, res) => {
  const quizId = req.params.id;
  const { studentId, studentName, questionId, selectedIndex } = req.body;

  if (!questionId || selectedIndex === undefined) {
    return res.status(400).json({ message: "Question ID and selected index required" });
  }

  try {
    // Check correctness first
    const quizForCheck = await Quiz.findById(quizId).select('questions');
    if (!quizForCheck) return res.status(404).json({ message: "Quiz not found" });

    const question = quizForCheck.questions.find(q => String(q._id) === String(questionId));
    if (!question) return res.status(404).json({ message: "Question not found in quiz" });

    const correct = typeof question.correctIndex === "number" && selectedIndex === question.correctIndex;
    const newAnswer = {
      questionId,
      selectedIndex,
      correct
    };

    let updatedQuiz = null;

    // A. Try to update existing submission by studentId
    // Use $elemMatch to properly scope the duplicate check to THIS student's answers only
    if (studentId) {
      updatedQuiz = await Quiz.findOneAndUpdate(
        {
          _id: quizId,
          submissions: {
            $elemMatch: {
              studentId: studentId,
              "answers.questionId": { $ne: questionId } // Check THIS student's answers only
            }
          }
        },
        {
          $push: { "submissions.$.answers": newAnswer },
          $set: { "submissions.$.submittedAt": new Date() }
        },
        { new: true }
      );
    }

    // B. If not found by ID, try by name (legacy/anonymous support)
    if (!updatedQuiz && studentName) {
      updatedQuiz = await Quiz.findOneAndUpdate(
        {
          _id: quizId,
          submissions: {
            $elemMatch: {
              studentName: studentName,
              studentId: null, // Only match if no ID set
              "answers.questionId": { $ne: questionId } // Check THIS student's answers only
            }
          }
        },
        {
          $push: { "submissions.$.answers": newAnswer },
          $set: {
            "submissions.$.submittedAt": new Date(),
            "submissions.$.studentId": studentId || null // Link ID if now available
          }
        },
        { new: true }
      );
    }

    // C. If still not found, create NEW submission
    if (!updatedQuiz) {
      // Check if this is a duplicate answer attempt
      const quizCheck = await Quiz.findOne({
        _id: quizId,
        $or: [
          {
            submissions: {
              $elemMatch: {
                studentId: studentId,
                "answers.questionId": questionId
              }
            }
          },
          {
            submissions: {
              $elemMatch: {
                studentName: studentName,
                studentId: null,
                "answers.questionId": questionId
              }
            }
          }
        ]
      });

      if (quizCheck) {
        return res.status(400).json({ message: "You have already submitted an answer for this question." });
      }

      // Not a duplicate, create new submission
      const newSubmission = {
        studentId: studentId || null,
        studentName: studentName || "Anonymous",
        answers: [newAnswer],
        submittedAt: new Date()
      };

      updatedQuiz = await Quiz.findOneAndUpdate(
        { _id: quizId },
        { $push: { submissions: newSubmission } },
        { new: true }
      );
    }

    const quiz = updatedQuiz; // Use the updated document for stats


    // Calculate aggregated stats
    const stats = calculateStats(quiz);

    // Add BullMQ job for score calculation and leaderboard update
    try {
      await scoreCalculationQueue.add("calculateScore", {
        quizId,
        studentId,
        studentName,
        questionId,
        correct
      });
      console.log(`✓ Added score calculation job for student ${studentName} on quiz ${quizId}`);

      // Also add leaderboard update job
      await leaderboardQueue.add("updateLeaderboard", {
        quizId,
        stats
      }, {
        delay: 100 // Small delay to let score calculation complete if needed
      });
      console.log(`✓ Added leaderboard update job for quiz ${quizId}`);
    } catch (queueErr) {
      console.error("BullMQ job creation error:", queueErr);
      // Continue with socket emit even if queue fails
    }

    // Emit updates via Socket.IO (immediate feedback)
    try {
      const io = sockets.getIo();
      if (io) {
        // Emit result update to teacher (leaderboard)
        io.to(quizId).emit("quiz:resultUpdate", stats);

        // Emit answerReceived for Live Responses view
        io.to(quizId).emit("quiz:answerReceived", {
          studentId,
          studentName: studentName || "Anonymous",
          questionId,
          selectedIndex
        });
        console.log(`📤 Emitted quiz:answerReceived to room ${quizId}:`, { studentName, questionId, selectedIndex });

        // Emit to student (optional, mainly for confirmation if needed)
        // We can emit the updated submission details to the student
        const currentSubmission = (quiz.submissions || []).find(s =>
          (studentId && s.studentId === studentId) ||
          (studentName && s.studentName === studentName && !s.studentId)
        );

        io.to(quizId).emit("quiz:studentResult", {
          quizId,
          studentId,
          submission: currentSubmission
        });

        try {
          const qdoc = quiz.toObject ? quiz.toObject() : quiz;
          if (qdoc && qdoc.code) {
            io.to(String(qdoc.code)).emit("quiz:resultUpdate", stats);
            io.to(String(qdoc.code)).emit("quiz:answerReceived", {
              studentId,
              studentName: studentName || "Anonymous",
              questionId,
              selectedIndex
            });
          }
        } catch (e) { /* ignore */ }
      }
    } catch (err) {
      console.error("Error emitting updates:", err);
    }

    return res.json({ ok: true, message: "Answer submitted" });

  } catch (err) {
    console.error("Submit single answer error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ---------------------------------------------
// SUBMIT ANSWERS (STUDENT) - DEPRECATED / LEGACY SUPPORT
// ---------------------------------------------
router.post("/:id/submit", auth, async (req, res) => {
  // ... (keep existing logic for backward compatibility if needed, or replace/remove)
  // For now, keeping it but the frontend will switch to submit-single
  const quizId = req.params.id;
  // ... (rest of the existing submit logic)
  // Just returning error to force use of single submit if we want to be strict, 
  // but let's leave it as is for safety.
  return res.status(400).json({ message: "Please use single submission." });
});

// ---------------------------------------------
// GET QUIZ RESULTS (TEACHER OR STUDENT WHO PARTICIPATED)
// ---------------------------------------------
router.get("/:id/results", auth, async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) return res.status(404).json({ message: "Quiz not found" });

    const isTeacher = String(quiz.teacher) === String(req.user.id);

    // Check if user is a student who participated in this quiz
    const studentId = req.user.id;
    const studentName = req.user.username || req.user.name;
    const isParticipant = (quiz.submissions || []).some(s =>
      s.studentId === studentId || s.studentName === studentName
    );

    // Allow if teacher OR participant (student who took the quiz)
    if (!isTeacher && !isParticipant) {
      return res.status(403).json({ message: "Not allowed" });
    }

    const stats = calculateStats(quiz);
    res.json(stats);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

function calculateStats(quiz) {
  // 1. Question-level stats (existing)
  const questionStats = quiz.questions.map(q => ({
    questionId: q._id,
    text: q.text,
    options: q.options,
    counts: q.options.map(() => 0)
  }));

  // 2. Leaderboard data with deduplication
  const studentMap = new Map(); // Map to deduplicate by studentId/studentName

  (quiz.submissions || []).forEach(sub => {
    // Create a unique key for this student
    const studentKey = sub.studentId || sub.studentName || "anonymous";

    let correctCount = 0;
    let wrongCount = 0;

    (sub.answers || []).forEach(ans => {
      // Update question counts
      const qStat = questionStats.find(qs => String(qs.questionId) === String(ans.questionId));
      if (qStat && typeof ans.selectedIndex === "number") {
        if (qStat.counts[ans.selectedIndex] !== undefined) {
          qStat.counts[ans.selectedIndex]++;
        }
      }

      // Update student score
      if (ans.correct) correctCount++;
      else wrongCount++;
    });

    // Calculate time taken (in seconds)
    let timeTaken = 0;
    if (quiz.startedAt && sub.submittedAt) {
      const diff = new Date(sub.submittedAt) - new Date(quiz.startedAt);
      timeTaken = Math.max(0, Math.floor(diff / 1000));
    }

    // Check if we already have an entry for this student
    if (studentMap.has(studentKey)) {
      // Merge with existing entry (take the better score or latest submission)
      const existing = studentMap.get(studentKey);

      // Keep the entry with more answers or better score
      if (sub.answers.length > existing.answerCount || correctCount > existing.correctAnswers) {
        studentMap.set(studentKey, {
          studentName: sub.studentName || "Anonymous",
          totalScore: correctCount,
          correctAnswers: correctCount,
          wrongAnswers: wrongCount,
          timeTaken,
          answerCount: sub.answers.length
        });
      }
    } else {
      // Add new entry
      studentMap.set(studentKey, {
        studentName: sub.studentName || "Anonymous",
        totalScore: correctCount,
        correctAnswers: correctCount,
        wrongAnswers: wrongCount,
        timeTaken,
        answerCount: sub.answers.length
      });
    }
  });

  // Convert map to array and remove the answerCount field (was only for comparison)
  const leaderboard = Array.from(studentMap.values()).map(({ answerCount, ...rest }) => rest);

  // Sort leaderboard: Score DESC, then TimeTaken ASC
  leaderboard.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return a.timeTaken - b.timeTaken;
  });

  // Assign ranks
  leaderboard.forEach((entry, idx) => {
    entry.rank = idx + 1;
  });

  return {
    quizId: quiz._id,
    totalSubmissions: studentMap.size, // Count unique students, not duplicate submissions
    questions: questionStats,
    leaderboard
  };
}


// ---------------------------------------------
// GET STUDENT'S OWN QUIZ RESULTS (for dashboard stats)
// ---------------------------------------------
router.get("/my-results", auth, async (req, res) => {
  try {
    const studentId = req.user.id;
    const studentName = req.user.username || req.user.name;

    // Find all finished quizzes where this student has submissions
    const quizzes = await Quiz.find({
      status: "finished",
      $or: [
        { "submissions.studentId": studentId },
        { "submissions.studentName": studentName }
      ]
    }).sort({ createdAt: -1 }).lean();

    let totalCorrect = 0;
    let totalQuestions = 0;
    const recentResults = [];

    quizzes.forEach(quiz => {
      // Find this student's submission
      const submission = quiz.submissions.find(s =>
        s.studentId === studentId || s.studentName === studentName
      );

      if (submission && submission.answers && submission.answers.length > 0) {
        const correct = submission.answers.filter(a => a.correct).length;
        const total = quiz.questions.length;

        totalCorrect += correct;
        totalQuestions += total;

        // Add to recent results (max 5)
        if (recentResults.length < 5) {
          recentResults.push({
            quizId: quiz._id,
            quizTitle: quiz.title,
            correct,
            total,
            percentage: total > 0 ? Math.round((correct / total) * 100) : 0,
            completedAt: submission.submittedAt
          });
        }
      }
    });

    const accuracy = totalQuestions > 0
      ? Math.round((totalCorrect / totalQuestions) * 100)
      : 0;

    res.json({
      quizzesAttempted: quizzes.length,
      accuracy,
      totalCorrect,
      totalQuestions,
      recentResults
    });
  } catch (err) {
    console.error("Get my results error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ---------------------------------------------
// DELETE QUIZ (TEACHER ONLY)
// ---------------------------------------------
router.delete("/:id", auth, async (req, res) => {
  try {
    const quizId = req.params.id;
    const quiz = await Quiz.findById(quizId);

    if (!quiz) return res.status(404).json({ message: "Quiz not found" });

    if (String(quiz.teacher) !== String(req.user.id)) {
      return res.status(403).json({ message: "Not allowed" });
    }

    await Quiz.findByIdAndDelete(quizId);

    try {
      const io = sockets.getIo();
      if (io) {
        io.to(quizId).emit("quiz:deleted", { quizId });
        try {
          const qdoc = quiz.toObject ? quiz.toObject() : quiz;
          if (qdoc && qdoc.code) io.to(String(qdoc.code)).emit("quiz:deleted", { quizId });
        } catch (e) { /* ignore */ }
      }
    } catch (_) { }

    return res.json({ ok: true, message: "Quiz deleted" });
  } catch (err) {
    console.error("Delete quiz error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
