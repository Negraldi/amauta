import unittest

import python.amauta as amauta


class SmokeTest(unittest.TestCase):
    def test_package_exposes_version(self):
        self.assertRegex(amauta.__version__, r"^\d+\.\d+\.\d+")


if __name__ == "__main__":
    unittest.main()
