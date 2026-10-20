const jwt = require("jsonwebtoken");
const prisma = require("../database/prisma");

async function authMiddleware(req, res, next) {
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

    if (typeof decoded.sub !== "string" || !decoded.sub) {
      return res.status(401).json({ success: false, message: "Token inválido." });
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.sub },
      select: { id: true },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Conta não encontrada. Entre novamente.",
      });
    }

    req.userId = user.id;

    return next();
  } catch (error) {
    if (!(error instanceof jwt.JsonWebTokenError)) return next(error);
    return res.status(401).json({
      success: false,
      message: "Token inválido ou expirado."
    });
  }
}


module.exports = authMiddleware;
