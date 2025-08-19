# CSS Architecture

This directory contains the modular CSS architecture for SimpleShell.

## Structure

```
src/styles/
├── index.css              # Main entry point - imports all modules
├── global.css             # Global base styles (html, body, #root)
├── theme-transitions.css  # Theme switching transitions and animations
├── typography.css         # Typography-related Material-UI overrides
├── terminal.css          # Terminal-specific font and display settings
├── scrollbar.css         # Global scrollbar styling
└── glass-effect.css      # Glass/frosted effect utility classes
```

## Component-Level Styles

Individual components may have their own CSS files in the `/src/components/` directory:

- `WebTerminal.css` - Terminal container and xterm-specific styles
- `AIChatWindow.css` - AI chat message content styles
- `CodeHighlight.css` - Code syntax highlighting styles

## Usage

### Importing Styles

The main styles are imported once in `app.jsx`:

```js
import "./styles/index.css";
```

This automatically includes all modular styles.

### Adding New Styles

1. **Global styles**: Add to appropriate module in `/src/styles/`
2. **Component-specific styles**: Create new CSS file in `/src/components/` and import in the component
3. **Utility classes**: Add to existing modules or create new ones as needed

### CSS Modules vs Material-UI

This project uses a hybrid approach:

- **CSS files** for global styles, utilities, and complex component styling
- **Material-UI `sx` prop** for component-level styling and theming
- **Styled components** for complex themed components (e.g., GlassDialog)

## Migration Notes

The old `src/index.css` has been deprecated and replaced with this modular system. The old file now simply imports the new modular styles to ensure backward compatibility during the transition.

## Best Practices

1. Keep styles close to their usage (component-level CSS files)
2. Use the modular system for global styles
3. Prefer Material-UI theming for dynamic styling
4. Use CSS custom properties for values that change based on theme
5. Maintain consistency with existing naming conventions
