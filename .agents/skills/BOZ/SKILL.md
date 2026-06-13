```markdown
# BOZ Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill outlines the core development patterns and conventions used in the BOZ repository, a TypeScript codebase built with the Next.js framework. It covers file naming, import/export styles, commit message conventions, and testing patterns to ensure consistency and maintainability across the project.

## Coding Conventions

### File Naming
- Use **camelCase** for all file names.
  - **Example:**  
    `userProfile.ts`  
    `apiHandler.tsx`

### Import Style
- Use **alias imports** for modules.
  - **Example:**  
    ```typescript
    import { fetchData } from '@utils/api'
    import UserCard from '@components/userCard'
    ```

### Export Style
- Mixed export styles are used (both named and default exports).
  - **Example:**  
    ```typescript
    // Named export
    export function calculateTotal(a: number, b: number): number {
      return a + b
    }

    // Default export
    const UserProfile = () => { /* ... */ }
    export default UserProfile
    ```

### Commit Message Conventions
- Use **conventional commits** with a `feat` prefix for new features.
- Average commit message length: 45 characters.
  - **Example:**  
    ```
    feat: add user authentication to login page
    ```

## Workflows

### Creating a New Feature
**Trigger:** When adding a new feature to the codebase  
**Command:** `/new-feature`

1. Create a new file using camelCase naming.
2. Use alias imports for dependencies.
3. Export your component or function using either named or default export as appropriate.
4. Write a commit message using the `feat` prefix and a concise description.
5. Add or update corresponding test files (`*.test.*`).

### Refactoring Code
**Trigger:** When improving or restructuring existing code  
**Command:** `/refactor`

1. Identify code to refactor and ensure file names follow camelCase.
2. Update imports to use aliases if not already.
3. Adjust exports to maintain consistency (prefer default for components, named for utilities).
4. Update or add tests as needed.
5. Commit changes with a descriptive message (e.g., `refactor: optimize data fetching logic`).

## Testing Patterns

- Test files follow the `*.test.*` naming pattern (e.g., `userProfile.test.ts`).
- The testing framework is not explicitly specified.
- Place test files alongside the modules they test or in a dedicated test directory.
- Example test file:
  ```typescript
  // userProfile.test.ts
  import { render } from '@testing-library/react'
  import UserProfile from './userProfile'

  test('renders user profile correctly', () => {
    const { getByText } = render(<UserProfile />)
    expect(getByText('User Profile')).toBeInTheDocument()
  })
  ```

## Commands
| Command        | Purpose                                    |
|----------------|--------------------------------------------|
| /new-feature   | Scaffold a new feature with conventions    |
| /refactor      | Guide for refactoring code                 |
```