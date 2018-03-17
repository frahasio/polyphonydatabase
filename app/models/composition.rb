class Composition < ApplicationRecord
  belongs_to :title
  belongs_to :group
  has_many :inclusions, inverse_of: :composition
  has_and_belongs_to_many :composers
end
