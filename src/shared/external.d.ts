declare module 'fft.js' {
  export default class FFT {
    constructor(size: number)
    readonly size: number
    createComplexArray(): number[]
    realTransform(out: number[], data: ArrayLike<number>): void
    completeSpectrum(spectrum: number[]): void
    transform(out: number[], data: ArrayLike<number>): void
    inverseTransform(out: number[], data: ArrayLike<number>): void
    fromComplexArray(complex: number[], storage?: number[]): number[]
    toComplexArray(input: ArrayLike<number>, storage?: number[]): number[]
  }
}
