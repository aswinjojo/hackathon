import gzip
import pickle
import json
import numpy as np

class NoNumpyArrayUnpickler(pickle.Unpickler):
    def find_class(self, module, name):
        # If the pickle wants to load a numpy array, replace it with a lightweight dummy
        if module == "numpy.core.multiarray" and name == "reconstruct":
            return lambda *args: np.array([])   # empty array placeholder
        return super().find_class(module, name)


def load_without_arrays(filename):
    with gzip.open(filename, "rb") as f:
        return NoNumpyArrayUnpickler(f).load()


# -------- main extraction logic ----------
input_file = "obs.pkl.gz"
output_file = "sample.jsonl"
limit = 1000

# Load the top-level dictionary but WITHOUT real NumPy arrays
big_dict = load_without_arrays(input_file)

count = 0

with open(output_file, "w") as out:
    for key, data in big_dict.items():
        cleaned = {
            "id": key,
            "power_queue": float(data["power_queue"]),
            "power_exec": float(data["power_exec"]),
            "power_limit": float(data["power_limit"]),
        }

        out.write(json.dumps(cleaned) + "\n")
        count += 1

        if count >= limit:
            break

print("Extracted", count, "items into", output_file)
