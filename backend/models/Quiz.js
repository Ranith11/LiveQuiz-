// backend/models/Quiz.js
const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  options: [{ type: String, required: true }],
  correctIndex: { type: Number, default: null } // optional for teacher to set
});

const quizSchema = new mongoose.Schema({
  title: { type: String, required: true },
  // short join code (e.g. ABC123) students use to join a live quiz
  code: { type: String, unique: true, index: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  questions: [questionSchema],
  status: { type: String, enum: ["draft", "live", "finished"], default: "draft" },
  duration: { type: Number }, // quiz duration in minutes (optional)
  startedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  submissions: [{
    studentId: { type: String }, // or ObjectId if registered
    studentName: String,
    answers: [{
      questionId: String,
      selectedIndex: Number,
      correct: Boolean
    }],
    submittedAt: { type: Date, default: Date.now }
  }]
});

module.exports = mongoose.model("Quiz", quizSchema);
