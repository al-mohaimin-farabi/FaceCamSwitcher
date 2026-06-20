//! PCOB debugger subsystem: folder detection, file watching, log parsing and
//! the normalized observer state model. Replaces the legacy OCR pipeline.

pub mod detector;
pub mod parser;
pub mod state;
pub mod watcher;
