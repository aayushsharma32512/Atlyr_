import { resolvePreviewGender } from '../previewGender'

describe('resolvePreviewGender', () => {
  it('resolves female tokens without substring collisions', () => {
    expect(resolvePreviewGender('female')).toBe('female')
    expect(resolvePreviewGender('women')).toBe('female')
    expect(resolvePreviewGender("women's")).toBe('female')
    expect(resolvePreviewGender('womens')).toBe('female')
    expect(resolvePreviewGender('F')).toBe('female')
  })

  it('resolves male tokens without substring collisions', () => {
    expect(resolvePreviewGender('male')).toBe('male')
    expect(resolvePreviewGender('men')).toBe('male')
    expect(resolvePreviewGender("men's")).toBe('male')
    expect(resolvePreviewGender('mens')).toBe('male')
    expect(resolvePreviewGender('M')).toBe('male')
  })

  it('defaults safely for unknown/ambiguous values', () => {
    expect(resolvePreviewGender('unisex')).toBe('female')
    expect(resolvePreviewGender('women / men')).toBe('female')
    expect(resolvePreviewGender(undefined)).toBe('female')
    expect(resolvePreviewGender(null)).toBe('female')
    expect(resolvePreviewGender('')).toBe('female')
  })
})

