import { motion, useScroll } from "framer-motion";

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  return (
    <motion.div
      style={{ scaleX: scrollYProgress, transformOrigin: "0 50%" }}
      className="fixed left-0 right-0 top-0 z-[60] h-[2px] bg-gold"
    />
  );
}
