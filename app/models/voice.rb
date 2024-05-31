class Voice < ApplicationRecord
  belongs_to :composition, inverse_of: :voices, counter_cache: true
end
