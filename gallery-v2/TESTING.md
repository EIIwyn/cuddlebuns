# Gallery Testing Checklist

## 🌐 URLs for Comparison

**New Vite Gallery (Modern):**
- URL: http://localhost:5173
- Location: `E:\Code Stuff\cuddlebuns\gallery-v2`
- Tech: React + Vite (modern build system)

**Original Gallery (Old):**
- URL: Open `E:\Code Stuff\cuddlebuns\public\gallery\index.html` in browser
- Location: `E:\Code Stuff\cuddlebuns\public\gallery`
- Tech: React via CDN (no build system)

---

## ✅ Testing Checklist

### 1. Initial Load
- [ ] **New Gallery**: Page loads at http://localhost:5173
- [ ] **Old Gallery**: Open index.html in browser
- [ ] Both show "Loading gallery..." screen briefly
- [ ] Both show all 10 characters after loading
- [ ] Character buttons are color-coded correctly

**Characters to verify:**
1. Ruri Tinytale (cyan #7be3f2)
2. Nano Gure (pink #c4a0b0)
3. Ryenna (yellow #ffd93d)
4. Piper Permit (blue #4a5f8f)
5. Rixxy Brightful (hot pink #ff69b4)
6. Manon Merope (teal #4db8c4)
7. Pyon Phelix (pink #ff9ec9)
8. Yukiko Yasashi (purple #8b3a62)
9. UmaMusume (purple #8b3a62)
10. Miscellaneous (purple #8b3a62)

---

### 2. Character Selection
**Test with Ruri Tinytale:**
- [ ] Click "Ruri Tinytale" button
- [ ] Button highlights with cyan glow
- [ ] Social links appear (Twitter, VSona, Carrd)
- [ ] Version selector shows: "Ruri", "Wiwu", "Wubold"
- [ ] Reference sheet appears
- [ ] Two toggle buttons appear: "View Reference Sheet" | "View Past Commissions"

---

### 3. Version Switching
**Test version switching:**
- [ ] Click "Wiwu" version
- [ ] Reference sheet changes to Wiwu's sheet
- [ ] Commission count updates
- [ ] Click "Wubold" version
- [ ] Shows "No reference sheet yet" (Wubold has no ref sheet)
- [ ] Click back to "Ruri"
- [ ] Original reference sheet returns

---

### 4. Reference Sheet Viewing
**Test with Piper Permit (has 3 ref sheets):**
- [ ] Click "Piper Permit"
- [ ] Reference sheet loads
- [ ] Navigation arrows (‹ ›) appear
- [ ] Sheet indicator shows "1 / 3"
- [ ] Click next arrow (›) → shows sheet 2/3
- [ ] Click next again → shows sheet 3/3
- [ ] Click previous (‹) → goes back
- [ ] Download button (⬇) appears
- [ ] Click download → saves file with name `piper-permit-reference-sheet.png`
- [ ] Hover over sheet → zoom effect
- [ ] Click on sheet → opens in lightbox

---

### 5. Commission Gallery
**Test with Ruri Tinytale (has 14 commissions):**
- [ ] Click "View Past Commissions" button
- [ ] Commission grid appears
- [ ] Sort controls show: "Newest" | "Randomize"
- [ ] Click "Newest" → commissions in reverse order (newest first)
- [ ] Click "Randomize" → commissions shuffle randomly
- [ ] Each commission shows:
  - [ ] Artist name (e.g., "@puffiewaffles")
  - [ ] Hover effect (card lifts up, shadow appears)
  - [ ] Platform badge appears on hover (𝕏, S for Skeb, V for VGen)
- [ ] Animations stagger (cards appear one by one)

---

### 6. Lightbox Functionality
**Test image viewer:**
- [ ] Click any commission image
- [ ] Lightbox opens full-screen
- [ ] Image displays centered
- [ ] Artist name shows: "Commissioned from @artist"
- [ ] Platform button appears (e.g., "View on Twitter" with 𝕏 icon)
- [ ] Click platform button → opens source URL in new tab
- [ ] Close button (✕) visible in top right
- [ ] Keyboard shortcuts hint shows: "ESC to close"
- [ ] Press ESC → lightbox closes
- [ ] Click outside image → lightbox closes

**Test reference sheet in lightbox (Piper - 3 sheets):**
- [ ] Click reference sheet
- [ ] Lightbox opens
- [ ] Shows "Official Reference Sheet"
- [ ] Navigation arrows (‹ ›) appear
- [ ] Shows "1 / 3" indicator
- [ ] Press → (right arrow key) → next sheet
- [ ] Press ← (left arrow key) → previous sheet
- [ ] Download button shows
- [ ] Click download → saves file
- [ ] Press ESC → closes lightbox

---

### 7. Language Toggle
**Test bilingual support:**
- [ ] Click "日本語" button (top right)
- [ ] All text changes to Japanese:
  - [ ] Title: "リファレンスシート＆コミッション"
  - [ ] Character species translate (e.g., "Kobold" → "コボルド")
  - [ ] Buttons: "リファレンスシートを見る" | "過去のコミッションを見る"
  - [ ] Sort: "最新順" | "ランダム"
- [ ] Click "English" button
- [ ] Everything returns to English
- [ ] Language persists when switching characters

---

### 8. Empty States
**Test characters with no commissions:**
- [ ] Click "Pyon Phelix"
- [ ] Click "View Past Commissions"
- [ ] Shows: "🎨 No commissions yet for Pyon Phelix"
- [ ] Click "Yukiko Yasashi" → "C4 Idol" version
- [ ] Shows: "🎨 No commissions yet for Yukiko Yasashi (C4 Idol)"

---

### 9. Social Links
**Test social media buttons:**
- [ ] Ruri Tinytale has: Twitter (𝕏), VSona (VS), Carrd (🔗)
- [ ] All links clickable
- [ ] Open in new tabs
- [ ] Icons display correctly

---

### 10. Responsive Design
**Test browser resize:**
- [ ] Narrow browser window
- [ ] Character buttons stack properly
- [ ] Commission grid adjusts columns
- [ ] Images remain proportional
- [ ] Lightbox stays centered

---

### 11. Performance Comparison

**Original Gallery:**
- [ ] Note initial page load time
- [ ] JSX transpilation happens in browser (slower)
- [ ] React loads from CDN

**New Vite Gallery:**
- [ ] Note initial page load time (should be faster)
- [ ] Code is pre-compiled
- [ ] React bundled locally
- [ ] Hot reload works (edit code → instant update)

---

## 🔍 Side-by-Side Comparison Test

### Setup:
1. Open **Original Gallery**: `E:\Code Stuff\cuddlebuns\public\gallery\index.html` in Chrome
2. Open **New Gallery**: http://localhost:5173 in Edge (or another Chrome tab)
3. Arrange windows side-by-side

### Compare:
- [ ] Visual appearance identical
- [ ] Colors match exactly
- [ ] Fonts and spacing the same
- [ ] Animations feel the same
- [ ] Both galleries function identically

---

## ✨ New Gallery Advantages

**What you gain with the new version:**
- ✅ **Hot Module Replacement** - Edit code, see changes instantly (no refresh!)
- ✅ **Component Organization** - Code split into logical files
- ✅ **Modern Development** - Can now install any npm package
- ✅ **TypeScript Ready** - Easy to add type safety later
- ✅ **Optimized Builds** - Faster production performance
- ✅ **Better Debugging** - React DevTools work better
- ✅ **Maintainability** - Easier to update and extend

**What stays the same:**
- ✅ All features work identically
- ✅ Same visual design
- ✅ Same user experience
- ✅ All characters and data
- ✅ All images

---

## 🐛 Known Differences (Expected)

These are **intentional** differences due to modern best practices:

1. **Import statements** - Uses ES6 modules instead of CDN globals
2. **File structure** - Components in separate files vs. one big file
3. **Build process** - Vite compiles code vs. browser transpilation
4. **Dev server** - Runs on localhost:5173 vs. file:// protocol

---

## 📝 Testing Results

### Issues Found:
_Document any bugs or differences here_

- [ ] Issue 1: _______________________
- [ ] Issue 2: _______________________
- [ ] Issue 3: _______________________

### Verified Working:
_Check off features that work correctly_

- [ ] All 10 characters load
- [ ] Character selection works
- [ ] Version switching works
- [ ] Reference sheets display
- [ ] Commissions display
- [ ] Lightbox opens/closes
- [ ] Keyboard shortcuts work
- [ ] Language toggle works
- [ ] Downloads work
- [ ] External links work
- [ ] Sorting works
- [ ] Animations smooth
- [ ] No console errors

---

## 🎯 Success Criteria

Migration is successful when:
- ✅ All features from original gallery work
- ✅ Visual appearance matches exactly
- ✅ No console errors
- ✅ All 10 characters accessible
- ✅ All images load properly
- ✅ Keyboard shortcuts functional
- ✅ Language toggle works
- ✅ Performance is equal or better

---

## 🚀 Next Steps After Testing

Once testing is complete:
1. **Fix any bugs** found during testing
2. **Build for production**: `pnpm build`
3. **Test production build**: `pnpm preview`
4. **Deploy to VPS** (upload `dist/` folder)
5. **Keep old gallery** as backup until confident

---

**Happy Testing! 🎨**
