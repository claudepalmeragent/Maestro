# Maestro v0.14.5 -- Visual Theme Showcase

Regenerated 2026-02-17, archived at `__MD_ARCHIVE/THEMES_20260217_182050.md`.
Cross-ref `Codebase_Context_20260217_180422.md`.

---

## 1. Overview

Maestro ships with 17 built-in themes organized into three categories plus a custom theme builder.

- **Theme source:** `src/shared/themes.ts`
- **ThemeMode** supports `'light'`, `'dark'`, and `'vibe'`.
- Separate `lightThemeId` and `darkThemeId` with system preference sync.
- 14 `ThemeColors` properties (see Custom Theme section below).

---

## 2. Dark Themes (6)

- **Dracula**
  ![Dracula](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/dracula.png)

- **Monokai**
  ![Monokai](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/monokai.png)

- **Nord**
  ![Nord](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/nord.png)

- **Tokyo Night**
  ![Tokyo Night](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/tokyo-night.png)

- **Catppuccin Mocha**
  ![Catppuccin Mocha](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/catppuccin-mocha.png)

- **Gruvbox Dark**
  ![Gruvbox Dark](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/gruvbox-dark.png)

---

## 3. Light Themes (6)

- **GitHub**
  ![GitHub](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/github.png)

- **Solarized**
  ![Solarized](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/solarized.png)

- **One Light**
  ![One Light](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/one-light.png)

- **Gruvbox Light**
  ![Gruvbox Light](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/gruvbox-light.png)

- **Catppuccin Latte**
  ![Catppuccin Latte](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/catppuccin-latte.png)

- **Ayu Light**
  ![Ayu Light](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/ayu-light.png)

---

## 4. Vibes (4)

- **Pedurple** -- Pedram's signature purple aesthetic.
  ![Pedurple](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/pedurple.png)

- **Maestro's Choice** -- The official Maestro brand theme.
  ![Maestro's Choice](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/maestros-choice.png)

- **Dre Synth** -- Synthwave-inspired neon palette.
  ![Dre Synth](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/dre-synth.png)

- **InQuest** -- Inspired by InQuest cybersecurity.
  ![InQuest](https://raw.githubusercontent.com/pedramamini/Maestro/refs/heads/main/images/themes/inquest.png)

---

## 5. Custom Theme

User-configurable via the **Custom Theme Builder** (`CustomThemeBuilder.tsx` component in Settings).

Allows customizing all 14 `ThemeColors` properties:

| # | Property          | Description              |
|---|-------------------|--------------------------|
| 1 | `background`      | Main background color    |
| 2 | `foreground`      | Main text color          |
| 3 | `headerBg`        | Header background        |
| 4 | `headerFg`        | Header foreground        |
| 5 | `sidebarBg`       | Sidebar background       |
| 6 | `sidebarFg`       | Sidebar foreground       |
| 7 | `inputBg`         | Input field background   |
| 8 | `inputFg`         | Input field foreground   |
| 9 | `highlightColor`  | Highlight / hover color  |
|10 | `accentColor`     | Accent / brand color     |
|11 | `scrollbarColor`  | Scrollbar track color    |
|12 | `selectionBg`     | Selection background     |
|13 | `selectionFg`     | Selection foreground     |
|14 | `borderColor`     | Border / divider color   |
