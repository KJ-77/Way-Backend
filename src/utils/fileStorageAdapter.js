import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '../../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure local storage
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now();
    const originalName = file.originalname;
    cb(null, `${uniqueSuffix}-${originalName}`);
  }
});

// Create a multer instance with the storage engine
const upload = multer({ 
  storage: diskStorage,
  limits: {
    fileSize: 10 * 1024 * 1024, // Limit file size to 10MB
  },
  fileFilter: (req, file, cb) => {
    // Add file type validation if needed
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and PDF files are allowed.'));
    }
  }
});

// Function to convert file URL in production
export function getFileUrl(filename) {
  if (!filename) return null;
  
  if (process.env.NODE_ENV === 'production') {
    // In production, return the URL with the production domain
    // When using a cloud storage service like S3 or Cloudinary,
    // you would return the full URL from the cloud provider
    const productionUrl = process.env.PRODUCTION_URL || 'https://dr-diana-accademy-backend.vercel.app';
    return `${productionUrl}/uploads/${filename}`;
  } else {
    // In development, use local URL
    return `http://localhost:${process.env.PORT || 5001}/uploads/${filename}`;
  }
}

// Function to delete a file
export async function deleteFile(filename) {
  if (!filename) return;
  
  if (process.env.NODE_ENV === 'production') {
    // In production with a cloud storage service, you would
    // implement the delete logic using their API
    console.log(`In production, would delete: ${filename}`);
    return;
  }
  
  // For local development, delete from the filesystem
  const filePath = path.join(uploadDir, filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error(`Error deleting file ${filename}:`, err);
  }
}

export default upload; 