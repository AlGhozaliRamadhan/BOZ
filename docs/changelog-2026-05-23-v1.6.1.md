# Boz v1.6.1 Changelog

## ✨ New Features

- **Interactive AI Market Chat Agent:** A brand new `/run` mode has been added that allows you to have a continuous, live, two-way conversation with BOZ. 
  - Functions as a highly analytical AI quantitative assistant.
  - Automatically fetches real-time prices, news, and crowd sentiment when asked.
  - Capable of formulating clear action plans (Buy/Hold/Wait) based on market context and contrarian setups.
  - Accessible via the `/run` menu in the CLI.

## 🐛 Bug Fixes

- **AI Market Search UI Fix:** Fixed a major bug that caused duplicate text rendering (double characters/words) when typing inputs for the AI Market Search prompt. This occurred due to overlapping active input streams where the global keypress event listener continued to echo inputs while the dedicated standard readline interface was also active. The terminal's raw mode is now properly managed and restored upon command completion, ensuring smooth and conflict-free keyboard inputs.
