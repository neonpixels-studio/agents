# Issue Template: Design with Reference HTML

Use this template when creating GitHub issues that include a Claude-generated HTML design as the spec.

---

## Template

```markdown
## Summary

[One or two sentences describing what this feature or view is and where it lives in the app.]

## Design

![screenshot](<!-- drag and drop a screenshot of the design here -->)

<details>
<summary>Reference HTML</summary>

```html
<!-- Paste the full Claude design HTML output here -->
```

</details>

## Acceptance Criteria

- [ ] Matches the layout and visual structure of the reference HTML
- [ ] Uses the project's existing components and design tokens — do not copy raw HTML verbatim
- [ ] Matches spacing, typography, and color intent from the reference
- [ ] Responsive at all supported breakpoints
- [ ] [Add any feature-specific criteria here]

## Dependencies

- #[issue number] — [reason, if any]
```

---

## Notes for subagents

- The reference HTML is a **spec**, not implementation code. Translate it into the project's components, composables, and conventions.
- If the project has a design system or component library, prefer those over custom styles.
- If a UI element in the reference HTML has no equivalent in the codebase, implement it to match the intent and note the decision in the PR.
