// frontend\src\pages\Home.jsx

import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-900 text-white">
      <h1 className="text-4xl font-bold mb-10">Welcome to LiveQuiz+</h1>

      <div className="flex gap-6">
        <Link
          to="/login"
          className="px-8 py-3 text-lg bg-blue-600 rounded-lg hover:bg-blue-700 transition"
        >
          Login
        </Link>

        <Link
          to="/register"
          className="px-8 py-3 text-lg bg-green-600 rounded-lg hover:bg-green-700 transition"
        >
          Register
        </Link>
      </div>
    </div>
  );
}
