-- Migration: Add thumbnail column for social sharing images
ALTER TABLE shiurim ADD COLUMN thumbnail TEXT;
