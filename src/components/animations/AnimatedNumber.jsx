import { useState, useEffect } from 'react';
import { motion, useSpring } from 'framer-motion';

const AnimatedNumber = ({ value, duration = 1, decimals = 0, prefix = '', suffix = '' }) => {
  const [displayValue, setDisplayValue] = useState(0);
  
  const spring = useSpring(0, {
    stiffness: 100,
    damping: 20,
  });

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  useEffect(() => {
    const unsubscribe = spring.on('change', (v) => {
      setDisplayValue(v);
    });
    return unsubscribe;
  }, [spring]);

  return (
    <motion.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {prefix}
      {displayValue.toFixed(decimals)}
      {suffix}
    </motion.span>
  );
};

export default AnimatedNumber;