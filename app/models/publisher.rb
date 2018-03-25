class Publisher < ApplicationRecord
  has_and_belongs_to_many :sources, inverse_of: :publishers
end
