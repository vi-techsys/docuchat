import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { TextExtractionService } from '../services/text-extraction.service';
import { customLogger } from '../lib/logger';

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
    files: 5 // Max 5 files at once
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (TextExtractionService.isSupportedFileType(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Supported types: PDF, TXT, MD, CSV, JSON, HTML`));
    }
  }
});

// Middleware to handle single file upload
export const uploadSingle = upload.single('document');

// Middleware to handle multiple file uploads
export const uploadMultiple = upload.array('documents', 5);

// Validation middleware to check uploaded files
export const validateUploadedFiles = (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file && !req.files) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_FILE_UPLOADED',
          message: 'No file uploaded'
        }
      });
    }

    const files = req.files || [req.file];
    
    for (const file of files) {
      if (!file) continue;

      // Validate file size
      if (!TextExtractionService.isValidFileSize(file.size)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File ${file.originalname} exceeds maximum size of 50MB`
          }
        });
      }

      // Validate file type
      if (!TextExtractionService.isSupportedFileType(file.mimetype)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'UNSUPPORTED_FILE_TYPE',
            message: `File ${file.originalname} has unsupported type: ${file.mimetype}`
          }
        });
      }
    }

    customLogger.info(`Files uploaded successfully`, {
      fileCount: Array.isArray(files) ? files.length : 1,
      totalSize: Array.isArray(files) 
        ? files.reduce((sum, file) => sum + file.size, 0)
        : files.size
    });

    next();
  } catch (error) {
    customLogger.error(`File validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Error validating uploaded files'
      }
    });
  }
};

// Helper to save uploaded file to temporary location
export const saveUploadedFile = async (file: Express.Multer.File): Promise<string> => {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const uploadsDir = path.join(process.cwd(), 'uploads');
  
  // Ensure uploads directory exists
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
  
  // Generate unique filename
  const timestamp = Date.now();
  const randomString = Math.random().toString(36).substring(2, 15);
  const extension = path.extname(file.originalname);
  const filename = `${timestamp}_${randomString}${extension}`;
  const filePath = path.join(uploadsDir, filename);
  
  // Write file to disk
  await fs.writeFile(filePath, file.buffer);
  
  customLogger.info(`File saved to disk`, {
    originalName: file.originalname,
    savedPath: filePath,
    size: file.size
  });
  
  return filePath;
};
