/**
 * Age, for the two places it decides something: whether a vendor's identity
 * check can run, and whether someone may buy an age-restricted item.
 *
 * Deliberately conservative. An unknown or unparseable date of birth is not
 * an adult, and a birthday that has not happened yet this year has not
 * happened.
 */
const ADULT_AGE = 18;

const ageFromDateOfBirth = (dateOfBirth, now = new Date()) => {
  if (!dateOfBirth) {
    return null;
  }

  const born = new Date(dateOfBirth);

  if (Number.isNaN(born.getTime())) {
    return null;
  }

  let age = now.getFullYear() - born.getFullYear();
  const monthDelta = now.getMonth() - born.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < born.getDate())) {
    age -= 1;
  }

  return age;
};

const isAdult = (dateOfBirth, now = new Date()) => {
  const age = ageFromDateOfBirth(dateOfBirth, now);

  return age !== null && age >= ADULT_AGE;
};

module.exports = { ADULT_AGE, ageFromDateOfBirth, isAdult };
