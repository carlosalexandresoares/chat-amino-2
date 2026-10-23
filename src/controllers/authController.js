const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const prisma = require("../database/prisma");
const { imageMime, imageUrl, validExternalUrl, MAX_AVATAR_BYTES, MAX_BANNER_BYTES } = require('../services/profileImage');
const antiSpam = require('../services/antiSpam');

async function register(req, res) {
  try {
    if (!antiSpam.allowAuth(`register:${req.socket.remoteAddress}`, 20, 15 * 60000))
      return res.status(429).json({ message: 'Muitas contas criadas. Tente mais tarde.' });
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Preencha todos os campos."
      });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({
        success: false,
        message: "O nome de usuário deve ter entre 3 e 30 caracteres."
      });
    }

    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'E-mail inválido.' });
    }

    if (password.length < 6 || Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({
        success: false,
        message: "A senha deve ter pelo menos 6 caracteres e no máximo 72 bytes."
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
      },
      select: { id: true },
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
      },
      select: { id: true, username: true, email: true, level: true, xp: true, isSiteAdmin: true }
    });

    return res.status(201).json({
      success: true,
      message: "Usuário criado com sucesso!",
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        level: user.level,
        xp: user.xp,
        isSiteAdmin: user.isSiteAdmin
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
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!antiSpam.allowAuth(`login-ip:${req.socket.remoteAddress}`, 200, 15 * 60000) ||
        (email && email.length <= 254 && !antiSpam.allowAuth(`login-email:${email}`, 10, 15 * 60000)))
      return res.status(429).json({ message: 'Muitas tentativas. Aguarde antes de entrar novamente.' });

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Informe o e-mail e a senha."
      });
    }

    if (email.length > 254 || password.length > 1024) {
      return res.status(400).json({ success: false, message: 'Credenciais inválidas.' });
    }

    const user = await prisma.user.findUnique({
      where: {
        email
      },
      select: { id: true, username: true, email: true, password: true, avatar: true,
        banner: true, bio: true, level: true, xp: true, isSiteAdmin: true }
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
        xp: user.xp,
        isSiteAdmin: user.isSiteAdmin
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
        isSiteAdmin: true,
        profileVisibility: true,
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

const updateProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const body = req.body || {};
    const files = { avatar: req.files?.avatarFile?.[0], banner: req.files?.bannerFile?.[0] };
    for (const key of ['bio', 'avatar', 'banner']) {
      if (body[key] !== undefined && typeof body[key] !== 'string') {
        return res.status(400).json({ message: `${key} inválido.` });
      }
    }
    const bio = body.bio?.trim();
    if (bio !== undefined && bio.length > 300) return res.status(400).json({ message: 'A bio pode ter no máximo 300 caracteres.' });

    const updates = { ...(bio !== undefined ? { bio: bio || null } : {}) };
    const validatedFiles = {};
    for (const kind of ['avatar', 'banner']) {
      const file = files[kind];
      const link = body[kind]?.trim();
      if (file) {
        const maxSize = kind === 'avatar' ? MAX_AVATAR_BYTES : MAX_BANNER_BYTES;
        const mimeType = imageMime(file.buffer);
        if (file.size > maxSize || !mimeType) {
          return res.status(400).json({ message: `${kind === 'avatar' ? 'Avatar' : 'Banner'}: use JPG, PNG, WebP ou GIF com até ${maxSize / 1048576} MB.` });
        }
        validatedFiles[kind] = { data: file.buffer, mimeType };
        updates[kind] = imageUrl(userId, kind);
      } else if (link !== undefined) {
        if (link.length > 1000 || (link && !validExternalUrl(link))) {
          return res.status(400).json({ message: `Informe um link http ou https válido para ${kind}.` });
        }
        updates[kind] = link || null;
      }
    }

    const updatedUser = await prisma.$transaction(async tx => {
      for (const kind of ['avatar', 'banner']) {
        const image = validatedFiles[kind];
        if (image) {
          await tx.userImage.upsert({
            where: { userId_kind: { userId, kind } },
            create: { userId, kind, ...image }, update: image,
          });
        } else if (body[kind] !== undefined) {
          await tx.userImage.deleteMany({ where: { userId, kind } });
        }
      }
      return tx.user.update({ where: { id: userId }, data: updates,
        select: { id: true, username: true, email: true, avatar: true, banner: true,
          bio: true, xp: true, level: true, createdAt: true } });
    });

    const io = req.app.get('io');
    if (io) for (const socket of io.sockets.sockets.values()) {
      if (socket.user?.id === userId) socket.user = { ...socket.user, avatar: updatedUser.avatar };
    }

    return res.status(200).json({
      success: true,
      message: "Perfil atualizado com sucesso.",
      user: updatedUser,
    });
  } catch (error) {
    console.error(
      "Erro ao atualizar perfil:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Não foi possível atualizar o perfil.",
    });
  }
};

module.exports = {
  register,
  login,
  me,
  updateProfile,
};
