// frontend\src\pages\Register.jsx

import { useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";

export default function Register() {
  const [form, setForm] = useState({
    username: "",
    password: "",
    role: "student"
  });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      await axios.post("http://localhost:5000/api/auth/register", form);
      alert("Registration successful! You can now login.");
    } catch (err) {
      console.log("Register Error is " + err);
      alert("Error: " + err.response?.data?.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <form
        onSubmit={handleSubmit}
        className="bg-gray-800 p-8 rounded-lg shadow-lg w-80"
      >
        <h2 className="text-2xl font-bold mb-6 text-center">Register</h2>

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

        <select
          name="role"
          className="w-full p-3 mb-4 bg-gray-700 rounded"
          onChange={handleChange}
        >
          <option value="student">Student</option>
          <option value="teacher">Teacher</option>
        </select>

        <button
          type="submit"
          className="w-full p-3 bg-green-600 rounded hover:bg-green-700 transition"
        >
          Register
        </button>

        {/* Log in Link */}
        <p className="text-center mt-4 text-gray-400">
          Already have an account?{" "}
          <Link to="/login" className="text-blue-400 hover:underline">
            Log in
          </Link>
        </p>
      </form>
    </div>
  );
}
