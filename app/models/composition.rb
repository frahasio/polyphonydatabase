class Composition < ApplicationRecord
  belongs_to :title
  belongs_to :group, optional: true
  has_many :inclusions
  has_and_belongs_to_many :composers
end
