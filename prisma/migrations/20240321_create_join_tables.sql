-- Create join table for sources and publishers
CREATE TABLE IF NOT EXISTS "_SourcePublisher" (
    "A" INTEGER NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "B" INTEGER NOT NULL REFERENCES "publishers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create join table for sources and scribes
CREATE TABLE IF NOT EXISTS "_SourceScribe" (
    "A" INTEGER NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "B" INTEGER NOT NULL REFERENCES "scribes"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS "_SourcePublisher_B_index" ON "_SourcePublisher"("B");
CREATE INDEX IF NOT EXISTS "_SourceScribe_B_index" ON "_SourceScribe"("B"); 