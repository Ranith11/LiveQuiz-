// frontend/src/pages/LiveResults.jsx
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import "./LiveResults.css";

export default function LiveResults({ socket, api }) {
    const { quizId } = useParams();
    const navigate = useNavigate();
    const [quiz, setQuiz] = useState(null);
    const [stats, setStats] = useState(null);
    const [message, setMessage] = useState("");
    const token = sessionStorage.getItem("token");
    const username = sessionStorage.getItem("username") || "Teacher";

    useEffect(() => {
        if (!token) {
            navigate("/login");
            return;
        }

        // Load quiz details and initial stats
        (async () => {
            try {
                const list = await api.quiz.list(token);
                const found = list.find(q => q._id === quizId);
                if (found) setQuiz(found);
                else setMessage("Quiz not found.");

                const initialStats = await api.quiz.getResults(quizId, token);
                setStats(initialStats);
            } catch (err) {
                console.error(err);
                setMessage("Failed to load quiz details.");
            }
        })();

        // Socket setup
        if (socket && !socket.connected) {
            try { socket.connect(); } catch (e) { }
        }

        // Join room as teacher
        socket.emit("quiz:join", { quizId, role: "teacher", username });

        const onResultUpdate = (data) => {
            console.log("Received result update:", data);
            if (data && data.quizId === quizId) {
                setStats(data);
            }
        };

        socket.on("quiz:resultUpdate", onResultUpdate);

        return () => {
            socket.off("quiz:resultUpdate", onResultUpdate);
        };
    }, [quizId, socket, token, navigate, api, username]);

    // Get rank badge class
    const getRankClass = (rank) => {
        if (rank === 1) return "lr-rank-1";
        if (rank === 2) return "lr-rank-2";
        if (rank === 3) return "lr-rank-3";
        return "";
    };

    return (
        <div className="lr-page">
            {/* Header */}
            <div className="lr-header">
                <div className="lr-brand">
                    <div className="lr-logo">LQ</div>
                    <div className="lr-title">LiveQuiz+ <small>Results</small></div>
                </div>
                <div className="lr-user-area">
                    <span className="lr-username">{username}</span>
                    <button
                        className="lr-btn"
                        onClick={() => {
                            const role = sessionStorage.getItem("role");
                            navigate(role === "teacher" ? "/teacher" : "/student");
                        }}
                    >
                        ← Back to Dashboard
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="lr-main">
                <div className="lr-card">
                    {/* Quiz Header */}
                    <div className="lr-quiz-header">
                        <div>
                            <h2 className="lr-quiz-title">{quiz ? quiz.title : "Loading..."}</h2>
                            <div className="lr-quiz-status">Status: {quiz ? quiz.status : "..."}</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                            <div className={`lr-badge ${quiz?.status === 'live' ? 'lr-badge-live' : ''}`}>
                                {quiz?.status === 'live' ? '● Live View' : 'Results'}
                            </div>
                            <div className="lr-submissions">
                                Submissions: {stats ? stats.totalSubmissions : 0}
                            </div>
                        </div>
                    </div>

                    <hr className="lr-divider" />

                    {/* Leaderboard */}
                    <div>
                        {stats && stats.questions ? (
                            <>
                                <div className="lr-section-title">Leaderboard</div>
                                <div className="lr-table-container">
                                    <table className="lr-table">
                                        <thead>
                                            <tr>
                                                <th>Rank</th>
                                                <th>Name</th>
                                                <th>Total Score</th>
                                                <th>Correct</th>
                                                <th>Wrong</th>
                                                <th>Total Qs</th>
                                                <th>Submitted</th>
                                                <th>Pending</th>
                                                <th>Time</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {stats.leaderboard && stats.leaderboard.length > 0 ? (
                                                stats.leaderboard.map((entry, idx) => {
                                                    const totalQuestions = quiz?.questions?.length || 0;
                                                    const submitted = entry.correctAnswers + entry.wrongAnswers;
                                                    const notSubmitted = totalQuestions - submitted;

                                                    return (
                                                        <tr key={idx}>
                                                            <td>
                                                                <span className={`lr-rank-badge ${getRankClass(entry.rank)}`}>
                                                                    {entry.rank}
                                                                </span>
                                                            </td>
                                                            <td className="lr-student-name">{entry.studentName}</td>
                                                            <td className="lr-score">{entry.totalScore}</td>
                                                            <td className="lr-correct">{entry.correctAnswers}</td>
                                                            <td className="lr-wrong">{entry.wrongAnswers}</td>
                                                            <td>{totalQuestions}</td>
                                                            <td className="lr-submitted">{submitted}</td>
                                                            <td className="lr-not-submitted">{notSubmitted}</td>
                                                            <td>{entry.timeTaken}s</td>
                                                        </tr>
                                                    );
                                                })
                                            ) : (
                                                <tr>
                                                    <td colSpan="9" className="lr-empty">
                                                        No submissions yet.
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        ) : (
                            <div className="lr-loading">Loading stats...</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Message Toast */}
            {message && <div className="lr-message">{message}</div>}
        </div>
    );
}
