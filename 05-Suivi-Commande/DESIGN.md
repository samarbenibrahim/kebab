---
name: Soucoffe Digital Heritage
colors:
  surface: '#fff8f2'
  surface-dim: '#e2d9cb'
  surface-bright: '#fff8f2'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#fcf2e4'
  surface-container: '#f7edde'
  surface-container-high: '#f1e7d9'
  surface-container-highest: '#ebe1d3'
  on-surface: '#1f1b13'
  on-surface-variant: '#51443d'
  inverse-surface: '#353027'
  inverse-on-surface: '#f9efe1'
  outline: '#83746c'
  outline-variant: '#d5c3b9'
  surface-tint: '#805437'
  primary: '#502c12'
  on-primary: '#ffffff'
  primary-container: '#6b4226'
  on-primary-container: '#e9b08c'
  inverse-primary: '#f4ba96'
  secondary: '#6c5c44'
  on-secondary: '#ffffff'
  secondary-container: '#f6dfc0'
  on-secondary-container: '#726249'
  tertiary: '#4b2f1f'
  on-tertiary: '#ffffff'
  tertiary-container: '#644534'
  on-tertiary-container: '#dfb49e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdbc7'
  primary-fixed-dim: '#f4ba96'
  on-primary-fixed: '#311300'
  on-primary-fixed-variant: '#653d22'
  secondary-fixed: '#f6dfc0'
  secondary-fixed-dim: '#d9c4a5'
  on-secondary-fixed: '#251a07'
  on-secondary-fixed-variant: '#53452e'
  tertiary-fixed: '#ffdbca'
  tertiary-fixed-dim: '#e9bda7'
  on-tertiary-fixed: '#2d1608'
  on-tertiary-fixed-variant: '#5e402f'
  background: '#fff8f2'
  on-background: '#1f1b13'
  surface-variant: '#ebe1d3'
typography:
  display-lg:
    fontFamily: Playfair Display
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Playfair Display
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Playfair Display
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-sm:
    fontFamily: Playfair Display
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-lg:
    fontFamily: Montserrat
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Montserrat
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Montserrat
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Montserrat
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 48px
  xl: 80px
  gutter: 20px
  margin-mobile: 16px
  margin-desktop: 64px
---

## Brand & Style

The design system is anchored in the "Sensory Premium" aesthetic—combining the warmth of a traditional European coffee house with the precision of modern smart-retail technology. It targets a sophisticated audience that values both the ritual of coffee and the efficiency of a seamless digital experience.

The visual style is a blend of **Minimalism** and **Tactile Modernism**. It prioritizes high-quality typography and a rich, layered color palette to evoke an emotional response of comfort, reliability, and understated luxury. Surfaces should feel organic rather than synthetic, using subtle tonal shifts to guide the user's eye rather than aggressive borders or loud animations.

## Colors

The palette is derived from the lifecycle of a coffee bean, ranging from the light cream of steamed milk to the deep, near-black of a concentrated espresso. 

- **Primary (Coffee Brown):** Used for key actions, brand moments, and primary interactive states.
- **Secondary (Medium Beige):** Used for subtle accents, inactive states, and decorative elements that require a softer touch than the primary brown.
- **Neutral/Background (Cream & Light Beige):** These colors form the "canvas." Use the Cream (#FFF8EE) for the widest areas of the UI and Light Beige (#F5EBDD) to define sections or container backgrounds.
- **Typography:** Always use Very Dark Brown (#29170F) for body text and headings to maintain warmth while ensuring AAA accessibility contrast ratios. Pure black is strictly avoided to prevent the design from feeling clinical.

## Typography

This design system utilizes a high-contrast typographic pairing to signal the "Smart Cafeteria" positioning. 

**Playfair Display** is reserved for headlines and editorial moments. It provides the "Premium" anchor, suggesting heritage and craft. Use it sparingly to maintain its impact.

**Montserrat** handles all functional information. It is selected for its geometric clarity and excellent readability at small sizes on digital screens. 

- **Hierarchy:** Use `display-lg` for hero sections and product categories.
- **Utility:** Use `label-md` for price tags, nutrient information, and button labels to provide a clean, modern counterpoint to the serif headlines.

## Layout & Spacing

The layout philosophy follows a **Fixed Grid** approach for desktop (12 columns, 1200px max-width) and a **Fluid Grid** for mobile devices (4 columns). 

Generous whitespace is a core component of the "Premium" feel. Avoid crowding elements; instead, use the `lg` (48px) and `xl` (80px) spacing tokens to separate distinct content blocks. 

- **Rhythm:** All spacing must be a multiple of the 4px base unit. 
- **Mobile Reflow:** On mobile, vertical stacks are preferred. Cards that appear in a 3-column grid on desktop should transition to a horizontal scroll or single-column stack on mobile to maintain legibility of the serif headings.

## Elevation & Depth

Hierarchy is established through **Tonal Layering** supplemented by **Ambient Shadows**. 

- **The Base:** The primary background is Cream (#FFF8EE).
- **The Container:** Secondary surfaces (like cards or menus) use White (#FFFFFF) to "lift" off the cream background.
- **Shadows:** Use extremely soft, diffused shadows with a slight Coffee Brown tint rather than pure grey. (e.g., `box-shadow: 0 10px 30px rgba(62, 36, 21, 0.08)`).
- **Depth Levels:**
    - **Level 0 (Floor):** Page background.
    - **Level 1 (Card):** White surface with a soft shadow. Used for menu items.
    - **Level 2 (Overlay):** Used for modals and dropdowns, requiring a slightly darker shadow and a backdrop blur (10px) to maintain the "Smart" modern feel.

## Shapes

The shape language is "Softly Geometric." All interactive elements use a `0.5rem` (8px) base radius to ensure the UI feels approachable and organic, mirroring the rounded edges of ceramic cups and cafe furniture.

- **Small elements (Checkboxes, Tags):** 4px (Soft).
- **Standard elements (Buttons, Input Fields, Cards):** 8px (Rounded).
- **Large elements (Promo Banners, Modals):** 16px (Extra Rounded).
- **Icons:** Use minimal line icons with a 2px stroke weight and slightly rounded caps/joins to match the typography.

## Components

### Buttons
- **Primary:** Coffee Brown (#6B4226) background with White text. High-contrast, 8px corner radius.
- **Secondary:** Transparent background with a Medium Beige (#D8C3A5) 1.5px border and Very Dark Brown text.
- **Ghost:** No background or border; used for secondary navigation actions.

### Cards
- **Product Card:** White background, Level 1 shadow, 16px padding. Image at the top with a subtle 4px corner radius. Title in Playfair Display, Price in Montserrat Bold.

### Input Fields
- **Text Input:** Light Beige (#F5EBDD) background, no border by default. On focus, a 1.5px Coffee Brown border is added. 

### Chips & Selection
- **Status Chips:** Use a Very Dark Brown text on a Medium Beige background for "In Stock" or "New" labels. 
- **Selection:** For milk choices or bean types, use outlined chips that fill with Coffee Brown upon selection.

### Navigation
- **Top Bar:** Cream background with a very thin Medium Beige bottom border. Use `label-md` for navigation links to keep the interface feeling precise and modern.