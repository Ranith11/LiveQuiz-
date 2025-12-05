// frontend/src/pages/StudentDashboard.jsx
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./StudentDashboard.css";

/**
 * StudentDashboard - Forest Theme
 * Props:
 *  - socket: socket.io-client instance (shared)
 *  - api: { quiz: { list, getByCode, getMyResults } }
 */
export default function StudentDashboard({ socket, api }) {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState([]);
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState({
    quizzesAttempted: 0,
    accuracy: 0,
    recentResults: []
  });
  const token = sessionStorage.getItem("token");
  const username = sessionStorage.getItem("username") || "Student";

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
    // Prevent teachers from accessing student dashboard
    const role = sessionStorage.getItem("role");
    if (role === "teacher") {
      navigate("/teacher");
      return;
    }

    fetchQuizzes();
    fetchMyStats();

    // Listen for quiz:finished event to auto-refresh stats
    if (socket) {
      const handleQuizFinished = (data) => {
        console.log("StudentDashboard: quiz:finished received", data);
        // Refresh stats and quiz list when any quiz finishes
        fetchQuizzes();
        fetchMyStats();
      };

      const handleStatusUpdate = (data) => {
        console.log("StudentDashboard: quiz:statusUpdate received", data);
        if (data && data.status === "finished") {
          // Refresh stats when quiz is marked as finished
          fetchQuizzes();
          fetchMyStats();
        }
      };

      socket.on("quiz:finished", handleQuizFinished);
      socket.on("quiz:statusUpdate", handleStatusUpdate);

      return () => {
        socket.off("quiz:finished", handleQuizFinished);
        socket.off("quiz:statusUpdate", handleStatusUpdate);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchQuizzes() {
    try {
      const list = await api.quiz.list(token);
      // hide demo/sample quizzes from the UI
      const filtered = (list || []).filter(q => {
        if (!q) return false;
        if (q.status !== "live") return false;
        const title = String(q.title || "").trim();
        if (!title) return false;
        // exclude titles that start with demo/sample (case-insensitive)
        if (/^(demo|sample)/i.test(title)) return false;
        return true;
      });
      setQuizzes(filtered);
    } catch (err) {
      console.error("fetchQuizzes error", err);
      setMessage(err?.message || "Failed to load quizzes");
    }
  }

  async function fetchMyStats() {
    try {
      if (api.quiz.getMyResults) {
        const data = await api.quiz.getMyResults(token);
        setStats({
          quizzesAttempted: data.quizzesAttempted || 0,
          accuracy: data.accuracy || 0,
          recentResults: data.recentResults || []
        });
      }
    } catch (err) {
      console.error("fetchMyStats error", err);
      // Don't show error message for stats - not critical
    }
  }

  function joinQuiz(q) {
    // defensive: quiz id might be in _id or id
    const id = q && (q._id || q.id || q.quizId || q.quiz_id);
    if (!id) {
      // try reloading quizzes once
      setMessage("Quiz id not found — refreshing list...");
      fetchQuizzes();
      setTimeout(() => setMessage(""), 2000);
      return;
    }

    // navigate with both URL param and location.state (fallback for QuizPlayer)
    navigate(`/quiz/${id}`, { state: { quizId: id } });
  }

  async function handleJoinByCode() {
    const code = String(joinCode || "").trim();
    if (!code) {
      setMessage("Enter a quiz code to join.");
      setTimeout(() => setMessage(""), 3000);
      return;
    }
    try {
      setMessage("Looking up quiz...");
      const quiz = await api.quiz.getByCode(code);
      if (quiz && quiz._id) {
        navigate(`/quiz/${quiz._id}`);
      } else {
        setMessage("Quiz not found or not live.");
        setTimeout(() => setMessage(""), 3000);
      }
    } catch (err) {
      console.error("joinByCode error", err);
      setMessage(err?.message || "Failed to find quiz by code.");
      setTimeout(() => setMessage(""), 3000);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("username");
    sessionStorage.removeItem("userId");
    sessionStorage.removeItem("role");
    try { if (socket && socket.connected) socket.disconnect(); } catch (e) { }
    navigate("/login");
  }

  return (
    <div className="student-dash">
      {/* Header */}
      <div className="sd-header">
        <div className="sd-logo">
          <div className="sd-logo-icon">LQ</div>
          <div className="sd-logo-text">LiveQuiz+</div>
        </div>
        <div className="sd-user-area">
          <span className="sd-username">Hello, {username}! 👋</span>
          <button className="sd-logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </div>

      {/* Main Content */}
      <div className="sd-main">
        {/* Hero Join Card */}
        <div className="sd-hero-card">
          <h1>Join Your Quiz</h1>
          <p>Enter the code your teacher shared with you</p>
          <div className="sd-join-row">
            <input
              type="text"
              className="sd-join-input"
              placeholder="ENTER CODE"
              maxLength={6}
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleJoinByCode()}
            />
            <button className="sd-join-btn" onClick={handleJoinByCode}>
              Join Now →
            </button>
          </div>
        </div>

        {/* Two Column Grid */}
        <div className="sd-grid">
          {/* Left: Available Quizzes */}
          <div className="sd-card">
            <h3>Available Quizzes</h3>
            <ul className="sd-quiz-list">
              {quizzes.length === 0 ? (
                <div className="sd-empty-state">
                  No live quizzes right now. Ask your teacher to start one!
                </div>
              ) : (
                quizzes.map(q => (
                  <li key={q._id || q.id || Math.random()} className="sd-quiz-item">
                    <div>
                      <div className="sd-quiz-title">{q.title}</div>
                      <div className="sd-quiz-meta">
                        Started: {new Date(q.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="sd-quiz-actions">
                      <span className="sd-live-badge">● LIVE</span>
                      <button className="sd-join-quiz-btn" onClick={() => joinQuiz(q)}>
                        Join
                      </button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>

          {/* Right: Stats Card - Split Design */}
          <div className="sd-card sd-stats-card">
            {/* Top Half: Overall Performance */}
            <div className="sd-stats-section">
              <div className="sd-section-title">Overall Performance</div>
              <div className="sd-overall-stats">
                <div className="sd-stat-box">
                  <div className="sd-stat-number">{stats.quizzesAttempted}</div>
                  <div className="sd-stat-label">Quizzes Attempted</div>
                </div>
                <div className="sd-stat-box">
                  <div className="sd-stat-number">{stats.accuracy}%</div>
                  <div className="sd-stat-label">Accuracy Score</div>
                </div>
              </div>
            </div>

            {/* Bottom Half: Recent Quiz Results */}
            <div className="sd-stats-section">
              <div className="sd-section-title">Recent Quiz Results</div>
              {stats.recentResults.length === 0 ? (
                <div className="sd-no-results">
                  No quiz results yet. Complete a quiz to see your scores!
                </div>
              ) : (
                <div className="sd-recent-results">
                  {stats.recentResults.map((result, idx) => (
                    <div key={result.quizId || idx} className="sd-result-item">
                      <span className="sd-result-name">{result.quizTitle}</span>
                      <div className="sd-result-score">
                        <span className="sd-score-text">{result.correct}/{result.total}</span>
                        <div className="sd-score-bar">
                          <div
                            className="sd-score-fill"
                            style={{ width: `${result.percentage}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Message Toast */}
      {message && <div className="sd-message">{message}</div>}
    </div>
  );
}
