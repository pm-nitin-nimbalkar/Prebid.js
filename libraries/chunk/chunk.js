/**
 * http://npm.im/chunk
 * Returns an array with *size* chunks from given array
 *
 * Example:
 * ['a', 'b', 'c', 'd', 'e'] chunked by 2 =>
 * [['a', 'b'], ['c', 'd'], ['e']]
 */
export function chunk(array, size) {
  const newArray = [];

  for (let i = 0; i < Math.ceil(array.length / size); i++) {
    const start = i * size;
    const end = start + size;
    newArray.push(array.slice(start, end));
  }

  return newArray;
}
