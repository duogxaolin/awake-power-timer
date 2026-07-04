import { describe, expect, it } from 'vitest'
import { clamp, formatDuration } from './utils'

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('0:45')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(90)).toBe('1:30')
  })

  it('formats hours, minutes and seconds', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
  })

  it('clamps negative values to zero', () => {
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('clamp', () => {
  it('returns value when in range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to minimum', () => {
    expect(clamp(-2, 0, 10)).toBe(0)
  })

  it('clamps to maximum', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })
})
