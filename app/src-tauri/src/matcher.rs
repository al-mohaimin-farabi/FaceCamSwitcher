use serde::Serialize;
use strsim::normalized_levenshtein;

/// Character confusion groups for OCR error correction.
/// Mirrors the Python logic from ocr_engine.py.
const CONFUSION_GROUPS: &[&[char]] = &[
    &['0', 'O', 'o'],
    &['1', 'l', 'I', 'i'],
    &['5', 'S', 's'],
    &['8', 'B'],
    &['2', 'Z', 'z'],
    &['6', 'G'],
];

pub struct FuzzyMatcher {
    players: Vec<String>,
    threshold: f64, // 0-100 scale
}

#[derive(Debug, Clone, Serialize)]
pub struct MatchResult {
    pub raw_text: String,
    pub matched_name: Option<String>,
    pub confidence: f64,
    pub match_score: f64,
}

impl FuzzyMatcher {
    pub fn new(players: Vec<String>, threshold: f64) -> Self {
        Self { players, threshold }
    }

    pub fn update_players(&mut self, players: Vec<String>) {
        self.players = players;
    }

    /// Find the best matching player name for the given raw OCR text.
    pub fn find_match(&self, raw_text: &str, ocr_confidence: f64) -> MatchResult {
        if self.players.is_empty() || raw_text.trim().is_empty() {
            return MatchResult {
                raw_text: raw_text.to_string(),
                matched_name: None,
                confidence: ocr_confidence,
                match_score: 0.0,
            };
        }

        // Step 1: Direct fuzzy match
        let (best_name, best_score) = self.best_match(raw_text);

        if best_score >= 95.0 {
            return MatchResult {
                raw_text: raw_text.to_string(),
                matched_name: Some(best_name),
                confidence: ocr_confidence,
                match_score: best_score,
            };
        }

        // Step 2: Try OCR-corrected variants if score < 85
        if best_score < 85.0 {
            let variants = generate_variants(raw_text);
            let mut top_name = best_name;
            let mut top_score = best_score;

            for variant in variants {
                let (name, score) = self.best_match(&variant);
                if score > top_score {
                    top_score = score;
                    top_name = name;
                }
            }

            if top_score >= self.threshold {
                return MatchResult {
                    raw_text: raw_text.to_string(),
                    matched_name: Some(top_name),
                    confidence: ocr_confidence,
                    match_score: top_score,
                };
            }

            return MatchResult {
                raw_text: raw_text.to_string(),
                matched_name: None,
                confidence: ocr_confidence,
                match_score: top_score,
            };
        }

        if best_score >= self.threshold {
            MatchResult {
                raw_text: raw_text.to_string(),
                matched_name: Some(best_name),
                confidence: ocr_confidence,
                match_score: best_score,
            }
        } else {
            MatchResult {
                raw_text: raw_text.to_string(),
                matched_name: None,
                confidence: ocr_confidence,
                match_score: best_score,
            }
        }
    }

    /// Find the best matching player using a weighted ratio approach.
    /// Returns (player_name, score) where score is 0-100.
    fn best_match(&self, text: &str) -> (String, f64) {
        let text_lower = text.to_lowercase();
        let mut best = (String::new(), 0.0f64);

        for player in &self.players {
            let player_lower = player.to_lowercase();
            let score = weighted_ratio(&text_lower, &player_lower);
            if score > best.1 {
                best = (player.clone(), score);
            }
        }
        best
    }
}

/// Weighted ratio combining multiple string similarity metrics.
/// Returns a score 0-100 similar to rapidfuzz's WRatio.
fn weighted_ratio(a: &str, b: &str) -> f64 {
    // Direct normalized Levenshtein (full string comparison)
    let direct = normalized_levenshtein(a, b) * 100.0;

    // Partial match: check if one string is contained in the other
    let partial = partial_ratio(a, b);

    // Token sort: sort words alphabetically then compare
    let token_sort = {
        let mut words_a: Vec<&str> = a.split_whitespace().collect();
        let mut words_b: Vec<&str> = b.split_whitespace().collect();
        words_a.sort_unstable();
        words_b.sort_unstable();
        let sorted_a = words_a.join(" ");
        let sorted_b = words_b.join(" ");
        normalized_levenshtein(&sorted_a, &sorted_b) * 100.0
    };

    // Return the maximum of all metrics (similar to WRatio behavior)
    direct.max(partial).max(token_sort)
}

/// Partial ratio: slides the shorter string across the longer one
/// and returns the best substring match score (0-100).
fn partial_ratio(a: &str, b: &str) -> f64 {
    let (shorter, longer) = if a.len() <= b.len() {
        (a, b)
    } else {
        (b, a)
    };

    if shorter.is_empty() {
        return 0.0;
    }

    let short_len = shorter.len();
    if short_len >= longer.len() {
        return normalized_levenshtein(shorter, longer) * 100.0;
    }

    let mut best = 0.0f64;
    let longer_chars: Vec<char> = longer.chars().collect();
    let short_chars: Vec<char> = shorter.chars().collect();

    if longer_chars.len() < short_chars.len() {
        return normalized_levenshtein(shorter, longer) * 100.0;
    }

    for i in 0..=longer_chars.len().saturating_sub(short_chars.len()) {
        let window: String = longer_chars[i..i + short_chars.len()].iter().collect();
        let score = normalized_levenshtein(shorter, &window) * 100.0;
        if score > best {
            best = score;
        }
    }
    best
}

/// Generate OCR-corrected variants by substituting confused characters.
fn generate_variants(text: &str) -> Vec<String> {
    let mut variants = Vec::new();
    let chars: Vec<char> = text.chars().collect();

    for (i, &ch) in chars.iter().enumerate() {
        for group in CONFUSION_GROUPS {
            if group.contains(&ch) {
                for &replacement in *group {
                    if replacement != ch {
                        let mut v = chars.clone();
                        v[i] = replacement;
                        variants.push(v.iter().collect());
                    }
                }
            }
        }
    }
    variants
}
