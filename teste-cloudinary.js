const path = require("path");
const cloudinary = require("./config/cloudinary");

async function testarUpload() {
  try {
    const resultado = await cloudinary.uploader.upload(
      path.join(__dirname, "teste", "imagem.png"),
      {
        folder: "chat/figurinhas",
        resource_type: "image",
      }
    );

    console.log("Upload realizado com sucesso!");
    console.log("URL:", resultado.secure_url);
    console.log("ID:", resultado.public_id);
  } catch (erro) {
    console.error("Erro ao enviar:", erro.message);
    process.exitCode = 1;
  }
}

testarUpload();