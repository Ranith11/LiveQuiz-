// frontend/src/pages/QuizPlayer.jsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "./QuizPlayer.css";

export default function QuizPlayer({ socket, api }) {
  const { quizId: paramQuizId } = useParams();
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState(null);

  // single-question flow
  const [question, setQuestion] = useState(null);
  const [selected, setSelected] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  // full-quiz flow
  const [questionsList, setQuestionsList] = useState(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // per-question answers (for full-list view)
  const [answersMap, setAnswersMap] = useState({}); // { questionId: selectedIndex }
  const [submittedMap, setSubmittedMap] = useState({}); // { questionId: true }

  // Countdown timer
  const [timeRemaining, setTimeRemaining] = useState(null); // in seconds
  const [quizEnded, setQuizEnded] = useState(false); // quiz ended due to time
  const timerIntervalRef = useRef(null);

  const [message, setMessage] = useState("");
  const [connected, setConnected] = useState(false);
  const [showEndPopup, setShowEndPopup] = useState(false); // Quiz ended popup
  const [studentResult, setStudentResult] = useState({ correct: 0, total: 0 }); // Student's result
  const username = sessionStorage.getItem("username") || "Student";
  const userId = sessionStorage.getItem("userId");
  const token = sessionStorage.getItem("token");
  const mountedRef = useRef(false);

  // helper to obtain a safe quizId (useParams fallback to URL)
  function getSafeQuizId() {
    if (paramQuizId) return String(paramQuizId);
    try {
      const parts = window.location.pathname.split("/").filter(Boolean);
      return parts.length ? parts[parts.length - 1] : null;
    } catch (e) {
      return null;
    }
  }

  // emit join only when we have a quizId and socket is connected
  function emitJoinIfReady() {
    const safeId = getSafeQuizId();
    if (!safeId) return false;
    if (!socket || !socket.connected) return false;
    socket.emit("quiz:join", { quizId: safeId, role: "student", username });
    console.log("QuizPlayer: emitted quiz:join", { quizId: safeId, username });
    return true;
  }

  useEffect(() => {
    mountedRef.current = true;
    if (!token) {
      navigate("/login");
      return;
    }
    const role = sessionStorage.getItem("role");
    if (role === "teacher") {
      setMessage("You are logged in as a Teacher. Please logout and login as a Student to play.");
      return;
    }
    if (!socket) {
      setMessage("Socket not available");
      return;
    }

    if (!socket.connected) {
      try { socket.connect(); } catch (e) { console.warn(e); }
    }

    function onConnect() {
      console.log("Socket connected (QuizPlayer):", socket.id);
      setConnected(true);
      const joined = emitJoinIfReady();
      if (!joined) {
        setTimeout(() => {
          if (mountedRef.current) emitJoinIfReady();
        }, 250);
      }
    }

    function onDisconnect() {
      console.log("Socket disconnected (QuizPlayer)");
      setConnected(false);
    }

    function onQuestion(q) {
      if (!mountedRef.current) return;
      console.log("QuizPlayer: received quiz:question", q);
      setQuestion(q);
      setSelected(null);
      setSubmitted(false);
      setMessage("");
    }

    function onAnswerUpdate(data) {
      if (!mountedRef.current) return;
      // Answer update received
      console.log("QuizPlayer: received quiz:answerUpdate", data);
    }

    function onQuestionList(payload) {
      if (!mountedRef.current) return;
      console.log("QuizPlayer: received quiz:questionList", payload);
      if (!payload) return;
      if (payload.quizId && String(payload.quizId) !== String(getSafeQuizId())) {
        return;
      }

      const incoming = Array.isArray(payload.questions) ? payload.questions.map(q => ({
        id: String(q.id || q._id),
        text: q.text,
        options: q.options || []
      })) : [];

      setQuestionsList(prev => {
        if (!prev || prev.length === 0) return incoming;
        const map = new Map();
        prev.forEach(q => map.set(String(q.id || q._id), q));
        const result = [];
        incoming.forEach(q => {
          map.set(q.id, q);
          result.push(q);
        });
        for (const [id, q] of map.entries()) {
          if (!incoming.find(i => String(i.id) === String(id))) {
            result.push(q);
          }
        }
        return result;
      });

      setQuestion(null);
      setSelected(null);
      setSubmitted(false);
      setCurrentQuestionIndex(0);

      setAnswersMap(prevAnswers => {
        const next = {};
        incoming.forEach(q => {
          const id = String(q.id);
          if (prevAnswers[id] !== undefined) next[id] = prevAnswers[id];
        });
        return next;
      });

      setMessage("Quiz loaded — answer questions one by one.");
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("quiz:question", onQuestion);
    socket.on("quiz:answerUpdate", onAnswerUpdate);
    socket.on("quiz:questionList", onQuestionList);

    socket.on("quiz:statusUpdate", (data) => {
      console.log("quiz:statusUpdate", data);
      if (data && data.quizId === getSafeQuizId()) {
        setQuiz(prev => prev ? { ...prev, status: data.status, startedAt: data.startedAt, duration: data.duration || prev.duration } : prev);
        if (data.status === "live") {
          setMessage("Quiz is now live! Get ready.");
        }
        if (data.status === "finished") {
          setQuizEnded(true);
          // Fetch student result and show popup
          fetchAndShowResult();
        }
      }
    });

    // Listen for quiz:finished event (when teacher clicks Finish or timer expires)
    socket.on("quiz:finished", async (data) => {
      console.log("quiz:finished", data);
      if (data && data.quizId === getSafeQuizId()) {
        setQuizEnded(true);
        // Fetch student result and show popup
        fetchAndShowResult();
      }
    });

    // Helper function to fetch result and show popup
    async function fetchAndShowResult() {
      const safeId = getSafeQuizId();
      try {
        // Small delay to allow backend to process final submissions
        await new Promise(resolve => setTimeout(resolve, 800));

        // Try to get results from quiz results endpoint (more accurate)
        const results = await api.quiz.getResults(safeId, token);
        const studentName = sessionStorage.getItem("username") || "Student";
        const studentId = sessionStorage.getItem("userId");

        // Find this student in the leaderboard
        let found = false;
        if (results && results.leaderboard) {
          const myEntry = results.leaderboard.find(e =>
            e.studentName === studentName || e.studentId === studentId
          );
          if (myEntry) {
            const totalQ = results.questions?.length || questionsList?.length || 0;
            setStudentResult({ correct: myEntry.correctAnswers || 0, total: totalQ });
            found = true;
          }
        }

        // Fallback to my-results endpoint
        if (!found) {
          const myResults = await api.quiz.getMyResults(token);
          const thisQuizResult = myResults.recentResults?.find(r => String(r.quizId) === String(safeId));
          if (thisQuizResult) {
            setStudentResult({ correct: thisQuizResult.correct, total: thisQuizResult.total });
          } else {
            // Final fallback: show 0 correct out of total questions
            const totalQ = questionsList?.length || 0;
            setStudentResult({ correct: 0, total: totalQ });
          }
        }
      } catch (e) {
        console.error("Error fetching result:", e);
        // Fallback: show 0 correct out of total questions 
        const totalQ = questionsList?.length || 0;
        setStudentResult({ correct: 0, total: totalQ });
      }
      setShowEndPopup(true);
      setMessage("");
    }

    socket.on("quiz:studentResult", data => {
      console.log("quiz:studentResult (student sees):", data);
    });

    if (socket.connected) {
      setTimeout(() => { emitJoinIfReady(); }, 50);
    }

    (async function loadQuiz() {
      try {
        const list = await api.quiz.list(token);
        const found = (list || []).find(q => q._id === getSafeQuizId());
        if (found) setQuiz(found);
      } catch (err) {
        console.warn("QuizPlayer.loadQuiz error", err);
      }
    })();

    return () => {
      mountedRef.current = false;
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("quiz:question", onQuestion);
      socket.off("quiz:answerUpdate", onAnswerUpdate);
      socket.off("quiz:questionList", onQuestionList);
      socket.off("quiz:statusUpdate");
      socket.off("quiz:finished");
      socket.off("quiz:studentResult");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramQuizId, socket]);

  // Handle time expired - wrapped in useCallback to be used in useEffect
  const handleTimeExpired = useCallback(async () => {
    setQuizEnded(true);
    setMessage("Time's up! Auto-submitting your answers...");

    const safeId = getSafeQuizId();
    if (!safeId) return;



    if (questionsList && questionsList.length > 0) {
      for (const qItem of questionsList) {
        const qId = String(qItem.id || qItem._id);
        const selectedIdx = answersMap[qId];

        if (selectedIdx !== undefined && selectedIdx !== null && !submittedMap[qId]) {
          try {
            const payload = {
              studentId: userId || null,
              studentName: username,
              questionId: qId,
              selectedIndex: selectedIdx
            };
            await api.quiz.submitSingle(safeId, payload, token);
            setSubmittedMap(prev => ({ ...prev, [qId]: true }));

          } catch (err) {
            console.error("Auto-submit error for question", qId, err);
          }
        }
      }

      // Get actual correct answers from quiz results 
      const totalQuestions = questionsList.length;

      // Fetch actual result from backend leaderboard
      try {
        await new Promise(resolve => setTimeout(resolve, 800)); // Wait for backend processing
        const results = await api.quiz.getResults(safeId, token);
        const studentName = sessionStorage.getItem("username") || "Student";
        const studentId = sessionStorage.getItem("userId");

        let found = false;
        if (results && results.leaderboard) {
          const myEntry = results.leaderboard.find(e =>
            e.studentName === studentName || e.studentId === studentId
          );
          if (myEntry) {
            setStudentResult({ correct: myEntry.correctAnswers || 0, total: totalQuestions });
            found = true;
          }
        }

        if (!found) {
          // Fallback to my-results
          const myResults = await api.quiz.getMyResults(token);
          const thisQuizResult = myResults.recentResults?.find(r => String(r.quizId) === String(safeId));
          if (thisQuizResult) {
            setStudentResult({ correct: thisQuizResult.correct, total: thisQuizResult.total });
          } else {
            setStudentResult({ correct: 0, total: totalQuestions });
          }
        }
      } catch (e) {
        setStudentResult({ correct: 0, total: totalQuestions });
      }
    }

    if (question && selected !== null && !submitted) {
      try {
        socket.emit("quiz:answer", {
          quizId: safeId,
          selectedIndex: selected,
          studentId: userId,
          studentName: username
        });
        setSubmitted(true);
      } catch (err) {
        console.error("Auto-submit error for single question", err);
      }
    }

    // Emit socket event to notify backend to update quiz status to "finished"
    // Backend socket handler will update the database and notify all clients
    socket.emit("quiz:statusUpdate", { quizId: safeId, status: "finished" });
    console.log("QuizPlayer: Emitted quiz:statusUpdate - finished (timer expired)");

    // Show the quiz ended popup
    setShowEndPopup(true);
    setMessage("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionsList, answersMap, submittedMap, question, selected, submitted, socket, api, token, userId, username]);

  // Timer countdown effect
  useEffect(() => {
    if (!quiz || !quiz.duration || quiz.status !== "live") return;

    const calculateRemaining = () => {
      if (!quiz.startedAt) return quiz.duration * 60;
      const startTime = new Date(quiz.startedAt).getTime();
      const durationMs = quiz.duration * 60 * 1000;
      const endTime = startTime + durationMs;
      const now = Date.now();
      const remainingMs = endTime - now;
      return Math.max(0, Math.floor(remainingMs / 1000));
    };

    const initialRemaining = calculateRemaining();
    setTimeRemaining(initialRemaining);
    if (initialRemaining <= 0) {
      setQuizEnded(true);
    }

    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

    const intervalId = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 0) {
          clearInterval(intervalId);
          setQuizEnded(true);
          setMessage("Quiz Ended !!!");
          handleTimeExpired();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    timerIntervalRef.current = intervalId;

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [quiz, handleTimeExpired]);

  function formatTime(seconds) {
    if (seconds === null || seconds === undefined) return "N/A";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  function handleBack() {
    navigate("/student");
  }

  function handleLogout() {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("username");
    sessionStorage.removeItem("userId");
    sessionStorage.removeItem("role");
    try { if (socket && socket.connected) socket.disconnect(); } catch (e) { }
    navigate("/login");
  }

  function submitAnswer() {
    if (!question) return setMessage("No active question.");
    if (selected === null) return setMessage("Please select an option.");
    socket.emit("quiz:answer", { quizId: getSafeQuizId(), selectedIndex: selected, studentId: userId, studentName: username });
    setSubmitted(true);
    setMessage("Answer submitted!");
  }

  function selectForQuestion(qId, idx) {
    setAnswersMap(prev => ({ ...prev, [qId]: idx }));
  }

  async function submitSingleAnswer(qId, idx) {
    const sId = getSafeQuizId();
    if (!sId) return setMessage("Quiz ID missing.");
    if (idx === undefined || idx === null) return setMessage("Please select an option.");

    try {
      setMessage("Submitting answer...");
      const payload = {
        studentId: userId || null,
        studentName: username,
        questionId: qId,
        selectedIndex: idx
      };
      const res = await api.quiz.submitSingle(sId, payload, token);
      if (res && res.ok) {
        setMessage("Answer submitted!");
        setSubmittedMap(prev => ({ ...prev, [qId]: true }));
      } else {
        setMessage(res.message || "Failed to submit.");
      }
    } catch (err) {
      console.error("submitSingleAnswer error", err);
      setMessage(err.message || "Failed to submit answer.");
    }
  }

  // Navigation for full-screen question view
  function goToPrevQuestion() {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(prev => prev - 1);
      setMessage("");
    }
  }

  function goToNextQuestion() {
    if (questionsList && currentQuestionIndex < questionsList.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setMessage("");
    }
  }

  const role = sessionStorage.getItem("role");

  useEffect(() => {
    if (role === "teacher") {
      navigate("/teacher");
    }
  }, [role, navigate]);

  if (role === "teacher") return null;

  // Get current question for full-screen view
  const currentQuestion = questionsList && questionsList.length > 0 ? questionsList[currentQuestionIndex] : null;
  const currentQId = currentQuestion ? String(currentQuestion.id || currentQuestion._id) : null;
  const currentSelectedIdx = currentQId ? answersMap[currentQId] : undefined;
  const currentIsSubmitted = currentQId ? submittedMap[currentQId] : false;

  return (
    <div className="quiz-player">
      {/* Fixed Header */}
      <header className="qp-header">
        <div className="qp-header-left">
          <div className="qp-timer">
            <span className="qp-timer-icon">⏱</span>
            <span className={`qp-timer-value ${timeRemaining !== null && timeRemaining <= 60 ? 'danger' : timeRemaining <= 300 ? 'warning' : ''}`}>
              {quizEnded ? "ENDED" : formatTime(timeRemaining)}
            </span>
          </div>
          <div className="qp-student">
            <span className="qp-student-icon">👤</span>
            <span className="qp-student-name">{username}</span>
          </div>
          <div className={`qp-connection ${connected ? 'connected' : ''}`}>
            {connected ? "●" : "○"}
          </div>
        </div>
        <div className="qp-header-right">
          <button className="qp-back-btn" onClick={handleBack}>← Back</button>
          <button className="qp-logout" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      {/* Waiting Overlay */}
      {quiz && quiz.status !== "live" && (
        <div className="qp-waiting-overlay">
          <div className="qp-waiting-content">
            <div className="qp-waiting-title">Waiting for Host</div>
            <div className="qp-waiting-subtitle">The quiz has not started yet...</div>
            <div className="qp-waiting-quiz-name">{quiz.title}</div>
          </div>
        </div>
      )}

      {/* Question Area */}
      <main className="qp-main">
        {questionsList && questionsList.length > 0 && currentQuestion ? (
          <div className="qp-question-card">
            <div className="qp-question-number">Question {currentQuestionIndex + 1}</div>
            <div className="qp-question-text">{currentQuestion.text}</div>

            <div className="qp-options">
              {(currentQuestion.options || []).map((opt, i) => (
                <div
                  key={i}
                  className={`qp-option ${currentSelectedIdx === i ? 'selected' : ''} ${currentIsSubmitted || quizEnded ? 'disabled' : ''}`}
                  onClick={() => !currentIsSubmitted && !quizEnded && selectForQuestion(currentQId, i)}
                >
                  <span className="qp-option-letter">{String.fromCharCode(65 + i)}.</span>
                  <span className="qp-option-text">{opt}</span>
                </div>
              ))}
            </div>

            <div className="qp-button-row">
              <button
                className="qp-nav-btn"
                onClick={goToPrevQuestion}
                disabled={currentQuestionIndex === 0}
              >
                ← Previous
              </button>

              <button
                className={`qp-submit-btn ${currentIsSubmitted ? 'submitted' : ''}`}
                onClick={() => submitSingleAnswer(currentQId, currentSelectedIdx)}
                disabled={currentIsSubmitted || quizEnded || currentSelectedIdx === undefined}
              >
                {quizEnded ? "Quiz Ended" : currentIsSubmitted ? "Submitted ✓" : "Submit Answer"}
              </button>

              <button
                className="qp-nav-btn"
                onClick={goToNextQuestion}
                disabled={currentQuestionIndex >= questionsList.length - 1}
              >
                Next →
              </button>
            </div>

            {/* View Results button - appears when quiz ends */}
            {quizEnded && (
              <div className="qp-results-row">
                <button
                  className="qp-results-btn"
                  onClick={() => navigate(`/results/${getSafeQuizId()}`)}
                >
                  📊 View Results
                </button>
              </div>
            )}

            {message && <div className="qp-message">{message}</div>}
          </div>
        ) : question ? (
          // Single question flow (teacher sends one at a time)
          <div className="qp-question-card">
            <div className="qp-question-number">Current Question</div>
            <div className="qp-question-text">{question.text}</div>

            <div className="qp-options">
              {(question.options || []).map((opt, i) => (
                <div
                  key={i}
                  className={`qp-option ${selected === i ? 'selected' : ''} ${submitted || quizEnded ? 'disabled' : ''}`}
                  onClick={() => !submitted && !quizEnded && setSelected(i)}
                >
                  <span className="qp-option-letter">{String.fromCharCode(65 + i)}.</span>
                  <span className="qp-option-text">{opt}</span>
                </div>
              ))}
            </div>

            <div className="qp-button-row">
              <div></div>
              <button
                className={`qp-submit-btn ${submitted ? 'submitted' : ''}`}
                onClick={submitAnswer}
                disabled={submitted || quizEnded || selected === null}
              >
                {quizEnded ? "Quiz Ended" : submitted ? "Submitted ✓" : "Submit Answer"}
              </button>
              <div></div>
            </div>

            {/* View Results button - appears when quiz ends */}
            {quizEnded && (
              <div className="qp-results-row">
                <button
                  className="qp-results-btn"
                  onClick={() => navigate(`/results/${getSafeQuizId()}`)}
                >
                  📊 View Results
                </button>
              </div>
            )}

            {message && <div className="qp-message">{message}</div>}
          </div>
        ) : (
          <div className="qp-waiting-card">
            <div className="qp-waiting-card-title">{quiz ? quiz.title : "Quiz"}</div>
            <div className="qp-waiting-card-text">Waiting for questions from the teacher...</div>
          </div>
        )}
      </main>

      {/* Quiz Ended Popup */}
      {showEndPopup && (
        <div className="qp-end-overlay">
          <div className="qp-end-popup">
            <button
              className="qp-popup-close"
              onClick={() => navigate("/student")}
            >
              ✕
            </button>
            <div className="qp-end-icon">🎉</div>
            <h2 className="qp-end-title">Quiz Ended!</h2>
            <div className="qp-end-result">
              <span className="qp-result-label">Your Result</span>
              <span className="qp-result-score">{studentResult.correct}/{studentResult.total}</span>
            </div>
            <button
              className="qp-leaderboard-btn"
              onClick={() => navigate(`/results/${getSafeQuizId()}`)}
            >
              📊 View Leaderboard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
