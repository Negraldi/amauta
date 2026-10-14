import unittest

import python.gentle_lite as gentle_lite


class SmokeTest(unittest.TestCase):
    def test_package_exposes_version(self):
        self.assertRegex(gentle_lite.__version__, r"^\d+\.\d+\.\d+")


if __name__ == "__main__":
    unittest.main()
