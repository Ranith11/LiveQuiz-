// backend\middlewares\authMiddleware.js


const jwt = require("jsonwebtoken");

module.exports = function (req, res, next) {
  // Get the "Authorization" header
  const authHeader = req.headers["authorization"];

  // Format: "Bearer token_here"
  const token = authHeader && authHeader.split(" ")[1];

  // No token found
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    // Verify token using your secret key
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Store decoded data (id & role) in req.user
    req.user = decoded;

    // Allow request to continue to next handler
    next();

  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
