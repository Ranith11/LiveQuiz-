// frontend\src\pages\Login.jsx

import { useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();   // <-- added

  const [form, setForm] = useState({
    username: "",
    password: ""
  });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      const res = await axios.post("http://localhost:5000/api/auth/login", form);

      // Store token + role (using sessionStorage for tab-independent sessions)
      sessionStorage.setItem("token", res.data.token);
      sessionStorage.setItem("role", res.data.user.role);
      sessionStorage.setItem("username", res.data.user.username);
      sessionStorage.setItem("userId", res.data.user.id);

      alert("Login successful!");

      // 🔥 Redirect based on role
      if (res.data.user.role === "teacher") {
        navigate("/teacher");
      } else {
        navigate("/student");
      }

    } catch (err) {
      alert("Error: " + err.response?.data?.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-800 p-8 rounded-lg shadow-lg w-80"
      >
        <h2 className="text-2xl font-bold mb-6 text-center">Login</h2>

        <input
          type="text"
          name="username"
          placeholder="Username"
          className="w-full p-3 mb-4 bg-gray-700 rounded"
          onChange={handleChange}
          required
        />

        <input
          type="password"
          name="password"
          placeholder="Password"
          className="w-full p-3 mb-4 bg-gray-700 rounded"
          onChange={handleChange}
          required
        />

        <button
          type="submit"
          className="w-full p-3 bg-blue-600 rounded hover:bg-blue-700 transition"
        >
          Login
        </button>

        <p className="text-center mt-4 text-gray-400">
          New user?{" "}
          <Link to="/register" className="text-blue-400 hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
