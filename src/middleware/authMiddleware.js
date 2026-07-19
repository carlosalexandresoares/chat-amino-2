const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization) {
    return res.status(401).json({
      success: false,
      message: "Token não informado."
    });
  }

  const [type, token] = authorization.split(" ");

  if (type !== "Bearer" || !token) {
    return res.status(401).json({
      success: false,
      message: "Token inválido."
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.userId = decoded.sub;

    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token inválido ou expirado."
    });
  }
}


module.exports = authMiddleware;