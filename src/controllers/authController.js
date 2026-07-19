const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../database/prisma");

async function register(req, res) {
  try {
    const username = req.body.username?.trim();
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Preencha todos os campos."
      });
    }

    if (username.length < 3) {
      return res.status(400).json({
        success: false,
        message: "O nome de usuário precisa ter pelo menos 3 caracteres."
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "A senha precisa ter pelo menos 6 caracteres."
      });
    }

    const userExists = await prisma.user.findFirst({
      where: {
        OR: [
          {
            username: {
              equals: username,
              mode: "insensitive"
            }
          },
          { email }
        ]
      }
    });

    if (userExists) {
      return res.status(409).json({
        success: false,
        message: "Usuário ou e-mail já cadastrado."
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: passwordHash
      }
    });

    return res.status(201).json({
      success: true,
      message: "Usuário criado com sucesso!",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        level: user.level,
        xp: user.xp
      }
    });
  } catch (error) {
    console.error("Erro no cadastro:", error);

    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
}

async function login(req, res) {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const password = req.body.password;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Informe o e-mail e a senha."
      });
    }

    const user = await prisma.user.findUnique({
      where: {
        email
      }
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "E-mail ou senha incorretos."
      });
    }

    const passwordIsValid = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordIsValid) {
      return res.status(401).json({
        success: false,
        message: "E-mail ou senha incorretos."
      });
    }

    if (!process.env.JWT_SECRET) {
      console.error("JWT_SECRET não está configurado.");

      return res.status(500).json({
        success: false,
        message: "Erro na configuração do servidor."
      });
    }

    const token = jwt.sign(
      {
        sub: user.id
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    return res.status(200).json({
      success: true,
      message: "Login realizado com sucesso!",
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar: user.avatar,
        banner: user.banner,
        bio: user.bio,
        level: user.level,
        xp: user.xp
      }
    });
  } catch (error) {
    console.error("Erro no login:", error);

    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
}

async function me(req, res) {
  try {
    const user = await prisma.user.findUnique({
      where: {
        id: req.userId
      },
      select: {
        id: true,
        username: true,
        email: true,
        avatar: true,
        banner: true,
        bio: true,
        xp: true,
        level: true,
        createdAt: true
      }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Usuário não encontrado."
      });
    }

    return res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    console.error("Erro ao buscar usuário:", error);

    return res.status(500).json({
      success: false,
      message: "Erro interno do servidor."
    });
  }
}

module.exports = {
  register,
  login,
  me
};