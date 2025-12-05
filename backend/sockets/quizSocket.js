// backend/sockets/quizSocket.js
const Quiz = require("../models/Quiz");
const redisService = require("../services/redisService");
const { scoreCalculationQueue, leaderboardQueue } = require("../queues");

/**
 * Quiz Socket Handler with Redis Integration
 * Uses Redis for state management instead of in-memory storage
 */

function setup(io) {
  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    // Teacher or student join a room
    socket.on("quiz:join", async ({ quizId, role, username }) => {
      if (!quizId) return;
      socket.join(quizId);
      socket.data.quizId = quizId;
      socket.data.role = role;
      socket.data.username = username || "Anonymous";
      console.log(`${socket.id} joined ${quizId} as ${role}`);

      // Store participant in Redis
      await redisService.addParticipant(quizId, {
        socketId: socket.id,
        username: socket.data.username,
        role,
        userId: socket.data.userId,
      });

      // Send current quiz status/timer info to the joining user
      try {
        const quiz = await Quiz.findById(quizId).select("status startedAt duration");
        if (quiz) {
          socket.emit("quiz:statusUpdate", {
            quizId,
            status: quiz.status,
            startedAt: quiz.startedAt,
            duration: quiz.duration,
            serverTime: Date.now(), // Send server time for sync
          });
        }
      } catch (e) {
        console.error("Error fetching quiz on join:", e);
      }

      // Send current active question if any from Redis
      const activeQuestion = await redisService.getActiveQuestion(quizId);
      if (activeQuestion) {
        socket.emit("quiz:question", activeQuestion);
        const counts = await redisService.getCounts(quizId);
        if (counts.length > 0) {
          socket.emit("quiz:answerUpdate", { counts });
        }
      }

      // Send full questions list if available
      const questionsList = await redisService.getQuestionsList(quizId);
      if (questionsList && questionsList.length > 0) {
        socket.emit("quiz:questionList", { quizId, questions: questionsList });
      }

      // Send current leaderboard if student
      if (role === "student") {
        const leaderboard = await redisService.getLeaderboard(quizId, 10);
        if (leaderboard.length > 0) {
          socket.emit("quiz:leaderboardUpdate", {
            quizId,
            leaderboard,
            updatedAt: Date.now(),
          });
        }
      }
    });

    // Teacher sends a new single question
    socket.on("quiz:question", async ({ quizId, question }) => {
      if (!quizId || !question) return;
      if (Array.isArray(question)) return; // Handle in quiz:questionList

      // Prepare question data
      const q = {
        id: String(question.id || question._id || Date.now()),
        text: question.text,
        options: question.options,
        sentAt: Date.now(),
      };

      // Store in Redis
      await redisService.setActiveQuestion(quizId, q);

      // Initialize counts
      const counts = Array.isArray(question.options) ? question.options.map(() => 0) : [];
      await redisService.initializeCounts(quizId, counts.length);

      // Clear previous respondents
      await redisService.clearRespondents(quizId);

      // Broadcast to the room
      io.to(quizId).emit("quiz:question", q);
      io.to(quizId).emit("quiz:answerUpdate", { counts });
      console.log(`Question sent to ${quizId}: ${q.text}`);
    });

    // Teacher sends full questions list (used when going live)
    socket.on("quiz:questionList", async ({ quizId, questions }) => {
      if (!quizId || !Array.isArray(questions)) return;

      // Store the list in Redis
      const questionsList = questions.map((q) => ({
        id: String(q.id || q._id || Date.now()),
        text: q.text,
        options: q.options,
      }));

      await redisService.setQuestionsList(quizId, questionsList);

      // Clear single-question state
      await redisService.clearActiveQuestion(quizId);
      await redisService.initializeCounts(quizId, 0);

      // Broadcast full list to room
      io.to(quizId).emit("quiz:questionList", { quizId, questions: questionsList });
      console.log(`Full question list sent to room ${quizId} (count=${questionsList.length})`);
    });

    // Teacher or timer updates status (e.g. make live or finish)
    socket.on("quiz:statusUpdate", async ({ quizId, status, startedAt }) => {
      if (!quizId) return;

      // Update quiz room in Redis
      await redisService.createQuizRoom(quizId, { status, startedAt });

      // If status is "finished", also update the database
      if (status === "finished") {
        try {
          await Quiz.findByIdAndUpdate(quizId, { status: "finished" });
          console.log(`Quiz ${quizId} status updated to finished in database`);
        } catch (err) {
          console.error(`Error updating quiz status in database:`, err);
        }
      }

      io.to(quizId).emit("quiz:statusUpdate", {
        quizId,
        status,
        startedAt,
        serverTime: Date.now() // Send server time for sync
      });

      // Emit quiz:finished event when quiz ends
      if (status === "finished") {
        io.to(quizId).emit("quiz:finished", {
          quizId,
          finishedAt: Date.now()
        });
        console.log(`Quiz ${quizId} finished - notifying all participants`);
      }

      console.log(`Status update for quiz ${quizId}: ${status}`);
    });

    // Student submits answer
    socket.on("quiz:answer", async ({ quizId, selectedIndex, studentId, studentName, questionId }) => {
      if (!quizId) return;

      // Check if this is for a single active question
      const activeQuestion = await redisService.getActiveQuestion(quizId);

      if (activeQuestion && activeQuestion.id) {
        // Single question mode - update counts
        const hasResponded = await redisService.hasResponded(quizId, socket.id);

        if (hasResponded) {
          console.log(`Socket ${socket.id} already answered. Ignoring.`);
          return;
        }

        // Record respondent
        await redisService.recordRespondent(quizId, socket.id, selectedIndex);

        // Update counts
        const counts = await redisService.getCounts(quizId);
        counts[selectedIndex] = (counts[selectedIndex] || 0) + 1;
        await redisService.updateCounts(quizId, counts);

        // Broadcast updated counts
        io.to(quizId).emit("quiz:answerUpdate", {
          counts,
          last: { studentId, studentName, selectedIndex, questionId: activeQuestion.id },
        });

        // Store answer for scoring
        await redisService.storeAnswer(quizId, activeQuestion.id, studentId, studentName, selectedIndex);

        // Queue score calculation job
        await scoreCalculationQueue.add("calculateScore", {
          quizId,
          questionId: activeQuestion.id,
          studentId,
          selectedIndex,
        });

        // Queue leaderboard update (debounced)
        await leaderboardQueue.add(
          "updateLeaderboard",
          { quizId, limit: 10 },
          { delay: 1000, jobId: `leaderboard-${quizId}` } // Debounce updates
        );

        return;
      }

      // Full quiz list mode - just store the answer
      if (questionId) {
        await redisService.storeAnswer(quizId, questionId, studentId, studentName, selectedIndex);

        // Queue score calculation
        await scoreCalculationQueue.add("calculateScore", {
          quizId,
          questionId,
          studentId,
          selectedIndex,
        });

        // Queue leaderboard update
        await leaderboardQueue.add(
          "updateLeaderboard",
          { quizId, limit: 10 },
          { delay: 1000, jobId: `leaderboard-${quizId}` }
        );

        // Emit answer received event
        io.to(quizId).emit("quiz:answerReceived", { studentId, studentName, selectedIndex, questionId });
        console.log(`Answer received (room ${quizId}) by ${studentName} for question ${questionId}: ${selectedIndex}`);
      }
    });

    // Handle disconnect
    socket.on("disconnect", async () => {
      console.log("Socket disconnected:", socket.id);
      const quizId = socket.data.quizId;

      if (quizId) {
        // Remove from participants
        await redisService.removeParticipant(quizId, socket.id);

        // If was a respondent, update counts
        const previousAnswer = await redisService.getRespondentAnswer(quizId, socket.id);
        if (previousAnswer !== null) {
          const counts = await redisService.getCounts(quizId);
          if (counts[previousAnswer] > 0) {
            counts[previousAnswer] = counts[previousAnswer] - 1;
            await redisService.updateCounts(quizId, counts);
            io.to(quizId).emit("quiz:answerUpdate", { counts });
          }
          await redisService.removeRespondent(quizId, socket.id);
        }
      }
    });
  });
}

module.exports = setup;
