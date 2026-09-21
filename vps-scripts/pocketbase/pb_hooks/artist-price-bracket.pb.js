const USD_TO_JPY = 150

function getNumber(record, fieldName) {
  const value = Number(record.get(fieldName))
  return Number.isFinite(value) && value > 0 ? value : 0
}

function calculatePriceBracket(record) {
  const priceJpy = getNumber(record, 'price_jpy')
  const priceUsd = getNumber(record, 'price_usd')

  const normalizedJpy = Math.max(
    priceJpy,
    priceUsd * USD_TO_JPY
  )

  let bracket = ''

  if (normalizedJpy > 0 && normalizedJpy <= 5000) {
    bracket = 'Affordable'
  } else if (normalizedJpy <= 15000) {
    bracket = 'Balanced'
  } else if (normalizedJpy <= 30000) {
    bracket = 'Premium'
  } else if (normalizedJpy > 30000) {
    bracket = 'Upscale'
  }

  record.set('price_bracket', bracket)
}

onRecordCreate((e) => {
  calculatePriceBracket(e.record)
  e.next()
}, 'artists')

onRecordUpdate((e) => {
  calculatePriceBracket(e.record)
  e.next()
}, 'artists')