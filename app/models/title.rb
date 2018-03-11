class Title < ApplicationRecord
  has_and_belongs_to_many :functions, inverse_of: :titles
end
