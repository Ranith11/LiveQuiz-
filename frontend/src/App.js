// frontend/src/App.js
import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import TeacherDashboard from "./pages/TeacherDashboard";
import StudentDashboard from "./pages/StudentDashboard";
import QuizPlayer from "./pages/QuizPlayer";
import LiveResults from "./pages/LiveResults";

import socket from "./socket";
import * as api from "./api";
import "./App.css";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/teacher" element={<TeacherDashboard socket={socket} api={api} />} />
        <Route path="/teacher/results/:quizId" element={<LiveResults socket={socket} api={api} />} />

        <Route path="/student" element={<StudentDashboard socket={socket} api={api} />} />
        <Route path="/quiz/:quizId" element={<QuizPlayer socket={socket} api={api} />} />
        <Route path="/results/:quizId" element={<LiveResults socket={socket} api={api} />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
