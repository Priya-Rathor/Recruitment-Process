import { PERSONA_HEAD } from "@/lib/marketing/home";
import { Section } from "@/components/marketing/Section";
import { SectionHeading } from "@/components/marketing/SectionHeading";
import { Reveal } from "@/components/marketing/Reveal";
import { PersonaSwitch } from "./PersonaSwitch";

/**
 * "Who it's for" — four perspectives on one workspace.
 *
 * FOUR, AND THEY ARE THE SITE'S EXISTING FOUR. The brief asked for five
 * personas including HR teams and startups; neither is a distinction this
 * product makes, and there is no hiring-manager role. The four here are
 * ROLE_FLOWS — already on /how-it-works, and already the four items in the
 * navbar's "Who It's For" menu. A homepage section naming five different
 * audiences would have contradicted the site's own navigation.
 *
 * A DEEP BAND, following the analytics band's light. It is also the right
 * ground for the section: the visual is the product's nav rail with most of it
 * dimmed, and dimming reads as dimming on navy rather than as something
 * greyed out and broken.
 *
 * A SERVER COMPONENT; only <PersonaSwitch> ships JavaScript.
 */
export function WhoItsFor() {
  return (
    <Section tone="dark" id="who-its-for">
      <SectionHeading
        eyebrow={PERSONA_HEAD.eyebrow}
        title={PERSONA_HEAD.title}
        lead={PERSONA_HEAD.lead}
        tone="dark"
      />

      <Reveal>
        <PersonaSwitch />
      </Reveal>
    </Section>
  );
}
