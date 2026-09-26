/// Explorer reuses one handler across selections, and WebView2 comes up
/// asynchronously: a preview started for an earlier file must not land after
/// `Unload` or on top of the next file (INV-3). Each start takes a token;
/// only the latest token is current.
#[derive(Default)]
pub struct Generation(u64);

#[derive(Clone, Copy)]
pub struct Token(u64);

impl Generation {
    pub fn advance(&mut self) -> Token {
        self.0 += 1;
        Token(self.0)
    }

    pub fn is_current(&self, token: Token) -> bool {
        self.0 == token.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_latest_token_is_current() {
        let mut generation = Generation::default();
        let token = generation.advance();
        assert!(generation.is_current(token));
    }

    #[test]
    fn an_earlier_token_goes_stale_once_a_new_one_is_taken() {
        let mut generation = Generation::default();
        let first = generation.advance();
        let second = generation.advance();
        assert!(!generation.is_current(first));
        assert!(generation.is_current(second));
    }
}
