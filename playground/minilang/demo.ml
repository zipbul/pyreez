// MiniLang Demo: Fibonacci + Higher-order functions + Closures

fn fib(n) {
  if (n <= 1) { return n; }
  return fib(n - 1) + fib(n - 2);
}

print("Fibonacci sequence:");
let mut i = 0;
while (i <= 10) {
  print("  fib(" + i + ") = " + fib(i));
  i = i + 1;
}

// Higher-order: map-like pattern
fn apply_twice(f, x) {
  return f(f(x));
}

fn double(n) { return n * 2; }
fn add10(n) { return n + 10; }

print("");
print("apply_twice(double, 3) = " + apply_twice(double, 3));
print("apply_twice(add10, 5) = " + apply_twice(add10, 5));

// Closure: counter factory
fn makeCounter(start) {
  let mut count = start;
  fn next() {
    count = count + 1;
    return count;
  }
  return next;
}

let c1 = makeCounter(0);
let c2 = makeCounter(100);
print("");
print("Counter 1: " + c1() + ", " + c1() + ", " + c1());
print("Counter 2: " + c2() + ", " + c2());

// Lambda + type checking
let transform = fn(x) {
  if (type(x) == "number") { return x * x; }
  if (type(x) == "string") { return x + "!"; }
  return null;
};

print("");
print("transform(5) = " + transform(5));
print("transform(\"hello\") = " + transform("hello"));
print("transform(null) = " + transform(null));

print("");
print("Done! MiniLang is working.");
