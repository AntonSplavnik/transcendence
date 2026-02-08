use smallvec::SmallVec;

pub trait Shrinkable {
    fn maybe_shrink(&mut self);
}

impl<T> Shrinkable for Vec<T> {
    #[inline]
    fn maybe_shrink(&mut self) {
        let len = self.len();
        let cap = self.capacity();
        if len > 15 && len <= cap / 4 {
            self.shrink_to(len * 2);
        }
    }
}

impl<T, const N: usize> Shrinkable for SmallVec<[T; N]> {
    #[inline]
    fn maybe_shrink(&mut self) {
        let len = self.len();
        let cap = self.capacity();
        if len <= cap / 4 {
            self.grow(len * 2);
        }
    }
}
