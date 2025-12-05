
// frontend/src/pages/TeacherDashboard.jsx
import React, { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./TeacherDashboard.css";

/**
 * TeacherDashboard - Forest Green Theme
 * Props:
 *  - socket: socket.io-client instance
 *  - api: { quiz: { list, create, updateStatus, createQuestion } }
 */
export default function TeacherDashboard({ socket, api }) {
  const navigate = useNavigate();
  const [quizzes, setQuizzes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Create quiz room workflow
  const [title, setTitle] = useState("");
  const [duration, setDuration] = useState("");

  // Active quiz (selected from list)
  const [activeQuiz, setActiveQuiz] = useState(null);
  const [message, setMessage] = useState("");
  const username = sessionStorage.getItem("username") || "Teacher";
  const tokenRef = useRef(null);

  // Live Responses view state
  const [showResponses, setShowResponses] = useState(false);
  const [responsesQuiz, setResponsesQuiz] = useState(null);
  const [studentResponses, setStudentResponses] = useState([]);

  // Add-question-to-active-quiz form fields
  const [aqText, setAqText] = useState("");
  const [aqOptions, setAqOptions] = useState(["", ""]);
  const [aqCorrectIndex, setAqCorrectIndex] = useState("");

  useEffect(() => {
    tokenRef.current = sessionStorage.getItem("token");
    if (!tokenRef.current) navigate("/login");
    fetchQuizzes();

    if (socket && !socket.connected) {
      try { socket.connect(); } catch (e) { /* ignore */ }
    }

    const onAnswerReceived = (data) => {
      console.log("📩 Received quiz:answerReceived", data);
      if (data) {
        setStudentResponses(prev => {
          const exists = prev.find(r => r.studentName === data.studentName && String(r.questionId) === String(data.questionId));
          if (exists) {
            return prev.map(r => r.studentName === data.studentName && String(r.questionId) === String(data.questionId) ? data : r);
          }
          return [...prev, data];
        });
      }
    };

    socket.on("quiz:answerReceived", onAnswerReceived);

    const onStatusUpdate = (data) => {
      console.log("📢 TeacherDashboard received quiz:statusUpdate", data);
      if (data && data.quizId && data.status) {
        setQuizzes(prev => prev.map(q =>
          q._id === data.quizId ? { ...q, status: data.status } : q
        ));
        if (data.status === "finished") {
          setActiveQuiz(prev => prev && prev._id === data.quizId ? null : prev);
          setShowResponses(false);
          setResponsesQuiz(null);
        }
      }
    };

    socket.on("quiz:statusUpdate", onStatusUpdate);

    return () => {
      socket.off("quiz:answerReceived", onAnswerReceived);
      socket.off("quiz:statusUpdate", onStatusUpdate);
    };
    // eslint-disable-next-line
  }, []);

  async function fetchQuizzes() {
    setLoading(true);
    try {
      const list = await api.quiz.list(tokenRef.current);
      const filtered = (list || []).filter(q => {
        if (!q) return false;
        const title = String(q.title || "").trim();
        if (!title) return true;
        if (/^(demo|sample)/i.test(title)) return false;
        return true;
      });
      setQuizzes(filtered);
    } catch (err) {
      console.error("fetchQuizzes", err);
      setMessage(err.message || "Failed to load quizzes");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateQuizRoom(e) {
    e && e.preventDefault();
    if (!title.trim()) return setMessage("Please enter a quiz title.");

    try {
      const token = tokenRef.current || sessionStorage.getItem("token");
      const payload = {
        title: title.trim(),
        questions: [],
        duration: duration ? parseInt(duration, 10) : undefined
      };

      const created = await api.quiz.create(payload, token);
      setQuizzes(prev => [created, ...prev]);
      setTitle("");
      setDuration("");
      setMessage("Quiz room created. Add questions using 'Manage Quiz' button.");
    } catch (err) {
      console.error("create quiz room error", err);
      setMessage(err.message || "Failed to create quiz room.");
    }
  }

  async function changeQuizStatus(q, status) {
    try {
      const updated = await api.quiz.updateStatus(q._id, status, tokenRef.current);
      setQuizzes(prev => prev.map(x => x._id === updated._id ? updated : x));
      setActiveQuiz(status === "live" ? updated : (status === "finished" ? null : updated));

      if (status === "live") {
        if (!socket.connected) {
          try { socket.connect(); } catch (e) { }
        }
        socket.emit("quiz:join", { quizId: updated._id, role: "teacher", username });
        socket.emit("quiz:statusUpdate", { quizId: updated._id, status: "live", startedAt: updated.startedAt });
        setMessage("Quiz is live. Students can join.");

        if (Array.isArray(updated.questions) && updated.questions.length > 0) {
          const qPayload = updated.questions.map(qit => ({
            id: qit._id,
            text: qit.text,
            options: qit.options
          }));
          socket.emit("quiz:questionList", { quizId: updated._id, questions: qPayload });
        }
      } else if (status === "finished") {
        if (!socket.connected) {
          try { socket.connect(); } catch (e) { }
        }
        socket.emit("quiz:statusUpdate", { quizId: updated._id, status: "finished" });
        setMessage("Quiz finished.");
      } else {
        setMessage(`Quiz status set to ${status}`);
      }
    } catch (err) {
      console.error("change status error", err);
      setMessage(err?.message || "Status change failed");
    }
  }

  async function addQuestionToActiveQuiz(e) {
    e && e.preventDefault();
    if (!activeQuiz) return setMessage("Select a quiz first");
    const text = aqText.trim();
    const options = aqOptions.map(s => s.trim()).filter(Boolean);
    if (!text) return setMessage("Enter question text.");
    if (options.length < 2) return setMessage("Provide at least 2 options.");

    try {
      const correctIndex =
        aqCorrectIndex === ""
          ? undefined
          : (() => {
            const num = parseInt(aqCorrectIndex, 10);
            return Number.isNaN(num) ? undefined : num - 1;
          })();

      const payload = { text, options, correctIndex };
      const token = tokenRef.current || sessionStorage.getItem("token");

      const res = await api.quiz.createQuestion(activeQuiz._id, payload, token);
      if (res && res.ok && res.question) {
        setActiveQuiz(prev => prev ? { ...prev, questions: [...(prev.questions || []), res.question] } : prev);
        setQuizzes(prev => prev.map(q => q._id === activeQuiz._id ? { ...q, questions: [...(q.questions || []), res.question] } : q));
      }

      setAqText(""); setAqOptions(["", ""]); setAqCorrectIndex("");
      setMessage("Question added to quiz (students will be updated).");

      try {
        if (socket && socket.connected) {
          const listToEmit = ((res && res.quiz && res.quiz.questions) ? res.quiz.questions : (activeQuiz.questions || []).concat(res.question ? [res.question] : []))
            .map(q => ({ id: q._id || q.id, text: q.text, options: q.options }));
          socket.emit("quiz:questionList", { quizId: activeQuiz._id, questions: listToEmit });
        }
      } catch (emitErr) {
        console.warn("Failed optimistic emit:", emitErr);
      }
    } catch (err) {
      console.error("addQuestionToActiveQuiz error", err);
      setMessage(err.message || "Failed to add question");
    }
  }

  async function fetchLiveResponses(quiz) {
    try {
      const token = tokenRef.current || sessionStorage.getItem("token");
      await api.quiz.getResults(quiz._id, token);

      const res = await fetch((process.env.REACT_APP_API_URL || "http://localhost:5000") + `/api/quiz/${quiz._id}/results`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      await res.json();

      const questions = quiz.questions || [];
      if (questions.length === 0) return;

      const latestQuestion = questions[questions.length - 1];
      const latestQuestionId = String(latestQuestion._id || latestQuestion.id);

      const quizList = await api.quiz.list(token);
      const freshQuiz = quizList.find(q => q._id === quiz._id);

      if (freshQuiz && freshQuiz.submissions) {
        const responses = [];
        freshQuiz.submissions.forEach(sub => {
          (sub.answers || []).forEach(ans => {
            if (String(ans.questionId) === latestQuestionId) {
              responses.push({
                studentName: sub.studentName || "Anonymous",
                studentId: sub.studentId,
                questionId: ans.questionId,
                selectedIndex: ans.selectedIndex
              });
            }
          });
        });
        setStudentResponses(responses);
      }
    } catch (err) {
      console.error("fetchLiveResponses error:", err);
    }
  }

  async function deleteQuiz(q, e) {
    e && e.stopPropagation();
    if (!q || !q._id) return;
    if (!window.confirm(`Delete quiz "${q.title}" permanently? This cannot be undone.`)) return;
    try {
      const token = tokenRef.current || sessionStorage.getItem("token");
      const res = await fetch((process.env.REACT_APP_API_URL || "http://localhost:5000") + `/api/quiz/${q._id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Delete failed (${res.status})`);
      }
      setQuizzes(prev => prev.filter(x => x._id !== q._id));
      if (activeQuiz && activeQuiz._id === q._id) setActiveQuiz(null);
      setMessage("Quiz deleted.");
    } catch (err) {
      console.error("deleteQuiz error", err);
      setMessage(err.message || "Failed to delete quiz.");
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

  function setAqOptionAt(idx, val) {
    setAqOptions(prev => prev.map((p, i) => i === idx ? val : p));
  }
  function addAqOption() { setAqOptions(prev => [...prev, ""]); }
  function removeAqOption(idx) { if (aqOptions.length <= 2) return; setAqOptions(prev => prev.filter((_, i) => i !== idx)); }

  return (
    <div className="td-dashboard">
      {/* Header */}
      <div className="td-header">
        <div className="td-brand">
          <div className="td-logo">LQ</div>
          <div className="td-title">LiveQuiz+ <small>Teacher</small></div>
        </div>
        <div className="td-user-area">
          <span className="td-username">Hello, {username} 👋</span>
          <button className="td-logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </div>

      {/* Main Content */}
      <div className="td-main">
        <div className="td-grid">
          {/* Left Card: Create Quiz + Quiz List */}
          <div className="td-card td-fade-in">
            <h3>Create a new Quiz Room</h3>
            <form onSubmit={handleCreateQuizRoom}>
              <input
                type="text"
                className="td-input"
                placeholder="Quiz title"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
              <input
                type="number"
                className="td-input"
                placeholder="Quiz Duration (in minutes)"
                min="1"
                value={duration}
                onChange={e => setDuration(e.target.value)}
              />
              <button type="submit" className="td-btn">Create Quiz Room</button>
            </form>

            <hr className="td-divider" />

            <h4>Your quizzes</h4>
            {loading ? (
              <div className="td-muted">Loading...</div>
            ) : (
              <ul className="td-quiz-list">
                {quizzes.map(q => (
                  <li key={q._id} className="td-quiz-item td-fade-in" onClick={() => { setActiveQuiz(q); setMessage(""); }}>
                    <div className="td-quiz-title">{q.title}</div>
                    <div className="td-quiz-meta">Created: {new Date(q.createdAt).toLocaleString()}</div>
                    <div className="td-quiz-meta">Questions: {(q.questions || []).length} • Code: <strong>{q.code}</strong></div>
                    <div className="td-quiz-actions">
                      <span className={`td-badge ${q.status === 'live' ? 'td-badge-live' : q.status === 'finished' ? 'td-badge-finished' : 'td-badge-draft'}`}>
                        {q.status}
                      </span>
                      {q.status === "live" && (
                        <button className="td-btn td-btn-small td-btn-red" onClick={(e) => { e.stopPropagation(); changeQuizStatus(q, "finished"); }}>Finish</button>
                      )}
                      {q.status !== "live" && q.status !== "finished" && (
                        <button className="td-btn td-btn-small td-btn-light" onClick={(e) => { e.stopPropagation(); changeQuizStatus(q, "live"); }}>Make live</button>
                      )}
                      {q.status !== "finished" && (
                        <button className="td-btn td-btn-small td-btn-light" onClick={(e) => { e.stopPropagation(); setActiveQuiz(q); setMessage(""); }}>Manage Quiz</button>
                      )}
                      {q.status === "live" && (
                        <button className="td-btn td-btn-small" onClick={async (e) => {
                          e.stopPropagation();
                          if (socket && !socket.connected) socket.connect();
                          socket.emit("quiz:join", { quizId: q._id, role: "teacher", username });
                          setResponsesQuiz(q);
                          setShowResponses(true);
                          setActiveQuiz(null);
                          await fetchLiveResponses(q);
                        }}>Responses</button>
                      )}
                      <button className="td-btn td-btn-small" onClick={(e) => { e.stopPropagation(); navigate(`/teacher/results/${q._id}`); }}>Live Results</button>
                      {q.status === "finished" && (
                        <button className="td-btn td-btn-small td-btn-red" onClick={(e) => deleteQuiz(q, e)}>Delete</button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Right Card: Active Quiz or Live Responses */}
          <div className="td-card td-fade-in">
            <h3>{showResponses ? "Live Responses" : "Active quiz"}</h3>

            {/* Live Responses View */}
            {showResponses && responsesQuiz ? (
              <div className="td-fade-in">
                <div className="td-response-header">
                  <div>
                    <div className="td-response-title">{responsesQuiz.title}</div>
                    <div className="td-muted">Code: <span className="td-code-box">{responsesQuiz.code}</span></div>
                  </div>
                  <button className="td-btn td-btn-small td-btn-light" onClick={() => { setShowResponses(false); setResponsesQuiz(null); }}>← Back</button>
                </div>

                {(responsesQuiz.questions || []).length === 0 ? (
                  <div className="td-muted">No questions added yet.</div>
                ) : (() => {
                  const questions = responsesQuiz.questions || [];
                  const question = questions[questions.length - 1];
                  const qIdx = questions.length - 1;
                  const questionId = String(question._id || question.id);
                  const questionResponses = studentResponses.filter(r => String(r.questionId) === questionId);
                  const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
                  return (
                    <div className="td-question-card td-fade-in">
                      <h4 style={{ margin: "0 0 8px 0", color: "var(--td-text-dark)" }}>Question {qIdx + 1}</h4>
                      <div className="td-question-title">{question.text}</div>
                      <div className="td-response-count">
                        {questionResponses.length} <span style={{ fontWeight: 400, color: "var(--td-text-medium)" }}>responded</span>
                      </div>

                      {questionResponses.length > 0 ? (
                        <table className="td-response-table">
                          <thead><tr><th>Student Name</th><th>Answer</th></tr></thead>
                          <tbody>
                            {questionResponses.map((resp, rIdx) => (
                              <tr key={rIdx} className="td-fade-in" style={{ animationDelay: `${rIdx * 0.05}s` }}>
                                <td>{resp.studentName || "Anonymous"}</td>
                                <td>{optionLetters[resp.selectedIndex] || (resp.selectedIndex + 1)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div className="td-muted">No responses yet for this question.</div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : activeQuiz && activeQuiz.status !== "finished" ? (
              <div className="td-fade-in">
                <div className="td-active-header">
                  <div>
                    <div className="td-active-title">{activeQuiz.title}</div>
                    <div className="td-active-meta">Status: {activeQuiz.status}</div>
                    {activeQuiz.code && <div className="td-code-box">{activeQuiz.code}</div>}
                  </div>
                  <button className="td-btn td-btn-small td-btn-light" onClick={() => { setActiveQuiz(null); setMessage(""); }}>← Back</button>
                </div>

                <h4>Add question to this quiz</h4>
                <input className="td-input" placeholder="Question text..." value={aqText} onChange={e => setAqText(e.target.value)} />

                <div className="td-muted" style={{ marginBottom: 6 }}>Options</div>
                {aqOptions.map((opt, idx) => (
                  <div key={idx} className="td-options-row">
                    <input className="td-input" placeholder={`Option ${idx + 1}`} value={opt} onChange={e => setAqOptionAt(idx, e.target.value)} />
                    <button type="button" className="td-btn td-btn-small td-btn-light" onClick={() => removeAqOption(idx)} disabled={aqOptions.length <= 2}>Remove</button>
                  </div>
                ))}
                <button type="button" className="td-btn td-btn-small" onClick={addAqOption} style={{ marginBottom: 14 }}>Add option</button>

                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <input className="td-input" placeholder="Correct option number (1-based, optional)" value={aqCorrectIndex} onChange={e => setAqCorrectIndex(e.target.value)} style={{ width: 280, marginBottom: 0 }} />
                  <button className="td-btn" onClick={addQuestionToActiveQuiz}>Add to quiz</button>
                </div>
                <div className="td-muted" style={{ marginTop: 8 }}>This saves the question to the quiz and notifies connected students.</div>
              </div>
            ) : (
              <div className="td-empty-state td-fade-in">
                <div className="td-cards-illustration">
                  <div className="td-card-shape"></div>
                  <div className="td-card-shape"></div>
                  <div className="td-card-shape">
                    <div className="td-card-line short"></div>
                    <div className="td-card-line long"></div>
                    <div className="td-card-line long"></div>
                  </div>
                </div>
                <div className="td-empty-title">No Quiz Selected</div>
                <div className="td-empty-text">Select a quiz from the left panel and click "Manage Quiz" to start adding questions.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Message Toast */}
      {message && <div className="td-message">{message}</div>}
    </div>
  );
}
