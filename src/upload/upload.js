import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Get current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, "../../uploads");
console.log("Upload directory:", uploadDir);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log("Created uploads directory");
}

// Set up storage for uploaded files
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + "-" + file.originalname;
    console.log("Saving file as:", uniqueName);
    cb(null, uniqueName);
  },
});

// Check file type
const fileFilter = (req, file, cb) => {
  console.log(
    "Processing file:",
    file.originalname,
    "Mimetype:",
    file.mimetype
  );

  // Always allow other form fields even if they're not files
  // This ensures videoTrailer JSON data is processed
  if (file.fieldname !== "image" && file.fieldname !== "pdf") {
    console.log(`Allowing non-file field: ${file.fieldname}`);
    return cb(null, true);
  }

  const allowedMimeTypes = /jpeg|jpg|png|gif|pdf/;
  const mimetype = allowedMimeTypes.test(file.mimetype);

  // Allow PDF files with application/pdf mimetype
  if (file.mimetype === "application/pdf") {
    return cb(null, true);
  }

  // For images, check both mimetype and extension
  const extname = /jpeg|jpg|png|gif/.test(
    path.extname(file.originalname).toLowerCase().substring(1)
  );

  if (mimetype && extname) {
    return cb(null, true);
  }

  cb(new Error("Only image files and PDF documents are allowed!"));
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max file size
  fileFilter: fileFilter,
});

export default upload;
