// frontend/src/api.js
const BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";

async function request(path, method = "GET", body = null, token = null) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw data;
  return data;
}

export const auth = {
  register: (payload) => request("/api/auth/register", "POST", payload),
  login: (payload) => request("/api/auth/login", "POST", payload),
};

export const quiz = {
  create: (payload, token) => request("/api/quiz", "POST", payload, token),
  list: (token) => request("/api/quiz", "GET", null, token),
  updateStatus: (id, status, token) => request(`/api/quiz/${id}/status`, "PATCH", { status }, token),
  createQuestion: (quizId, payload, token) => request(`/api/quiz/${quizId}/question`, "POST", payload, token),
  // NEW: submit all answers for a quiz (student)
  submitAnswers: (quizId, payload, token) => request(`/api/quiz/${quizId}/submit`, "POST", payload, token),
  // NEW: lookup live quiz by join code (students)
  getByCode: (code) => request(`/api/quiz/code/${encodeURIComponent(String(code).trim())}`, "GET"),
  // NEW: get full results (teacher)
  getResults: (id, token) => request(`/api/quiz/${id}/results`, "GET", null, token),
  // NEW: submit single answer
  submitSingle: (quizId, payload, token) => request(`/api/quiz/${quizId}/submit-single`, "POST", payload, token),
  // NEW: get student's own quiz results for dashboard
  getMyResults: (token) => request("/api/quiz/my-results", "GET", null, token),
};
