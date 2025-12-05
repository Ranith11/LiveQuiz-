// backend\controllers\authController.js


const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// REGISTER USER
exports.registerUser = async (req, res) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const exists = await User.findOne({ username });
    if (exists) {
      return res.status(400).json({ message: "User already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const user = new User({
      username,
      password: hashed,
      role,
    });

    await user.save();

    res.json({ message: "Registration successful" });

  } catch (err) {
    console.log("the error is")
    console.log("Register Error is " + err);
    res.status(500).json({ message: "Server error" });
  }
};

// LOGIN USER
exports.loginUser = async (req, res) => {
  try {
    console.log("LOGIN BODY:", req.body);

    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ message: "User not found" });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ message: "Incorrect password" });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      message: "Login success",
      token,
      user: {
        id: user._id,
        username: user.username,
        role: user.role,
      },
    });

  } catch (err) {
    console.log(err)
    res.status(500).json({ message: "Server error" });
  }
};
