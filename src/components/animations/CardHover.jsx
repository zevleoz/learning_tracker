import { motion } from 'framer-motion';

const CardHover = ({ children, className = '', style = {} }) => {
  return (
    <motion.div
      whileHover={{ 
        y: -4, 
        transition: { duration: 0.2, ease: [0.4, 0, 0.2, 1] } 
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
};

export default CardHover;